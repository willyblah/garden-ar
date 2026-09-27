"""把 images/ 里的古画处理成网页用的素材。

依赖：pip install torch transformers pillow numpy scipy scikit-image
用法：python tools/prep.py                （在项目根目录运行）
      python tools/prep.py --reuse-depth  （不跑深度模型，沿用 assets 里已有的深度，只重新分层）

思路：像纸雕一样把画面分成几层卡纸叠起来。每一层都整张落在下一层上，
所以不会有悬空的碎片；层与层之间的侧壁在网页里按轮廓线生成。

每张画输出三个文件到 assets/：
  N-color.jpg   原画（1024px）
  N-relief.png  R = 深度（越亮越近，用于雾气远近）
                G = 层号（0 是纸面，LEVELS 是最高一层），边缘略微柔化，网页按 0.5 取等值线
                B = 层号的大范围模糊，用来给层脚压一点阴影
  N-walls.json  每层侧壁的轮廓线（uv 坐标 × 4096 取整）
另外把每张画的纸色写进 assets/paper.json。
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
RES = 1024
LEVELS = 5        # 纸面以上的层数，改了要同时改 js/painting.js 里的 LEVELS
MARGIN = 16       # 画边留出的纸面宽度（px）
MIN_AREA = 2500   # 小于它的层块、孔洞都不要（px）
GROUND_WINDOW = 400  # 比它窄的都算景物（px）
MIN_TREAD = 16    # 台阶最窄的宽度（px）
SMOOTH = 5        # 层轮廓的圆滑程度（开闭运算半径，px）


def estimate_depth(im):
    from transformers import pipeline
    global _pipe
    if "_pipe" not in globals():
        _pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Base-hf")
    d = _pipe(im)["predicted_depth"].squeeze().numpy().astype(np.float32)
    d = np.array(Image.fromarray(d).resize((RES, RES), Image.BICUBIC))
    lo, hi = np.percentile(d, [1, 99])
    return ndi.median_filter(np.clip((d - lo) / (hi - lo), 0, 1), 5)


def box(x, r):
    return ndi.uniform_filter(x, 2 * r + 1, mode="reflect")


def guided(guide, src, r, eps):
    """导向滤波：让深度的边缘贴合画里的墨线"""
    mi, mp = box(guide, r), box(src, r)
    a = (box(guide * src, r) - mi * mp) / (box(guide * guide, r) - mi * mi + eps)
    b = mp - a * mi
    return box(a, r) * guide + box(b, r)


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def fit_ground(d):
    """地面：大窗口的形态学开运算，把比窗口窄的景物削平，剩下的就是地面的远近起伏"""
    # 四边按原来的坡度往外延长，免得画边一圈被误当成景物
    w = GROUND_WINDOW // 4
    s = np.pad(d[::4, ::4], w, mode="reflect", reflect_type="odd")
    g = ndi.gaussian_filter(ndi.grey_opening(s, size=w), w / 4)[w:-w, w:-w]
    return np.array(Image.fromarray(g).resize((RES, RES), Image.BILINEAR))


def height(gray, depth):
    """只让高出地面的景物立起来，地面本身留在纸面上，免得整幅画变成斜坡"""
    d = guided(gray, depth, 6, 2e-3)
    above = np.clip(d - fit_ground(d) - 0.02, 0, None)
    return np.clip(above / max(np.percentile(above, 99.5), 0.1), 0, 1)


def clean(mask):
    """去掉毛刺、小碎块和小孔，让每一块都是能剪出来的完整形状"""
    mask = ndi.binary_opening(mask, disk(SMOOTH))
    mask = ndi.binary_closing(mask, disk(SMOOTH), border_value=0)
    lab, n = ndi.label(mask)
    if n:
        mask = np.isin(lab, 1 + np.flatnonzero(ndi.sum(mask, lab, range(1, n + 1)) >= MIN_AREA))
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n:
        mask |= np.isin(lab, 1 + np.flatnonzero(ndi.sum(holes, lab, range(1, n + 1)) < MIN_AREA))
    return mask


def layer(h):
    """逐层取阈值，每层都限制在下一层之内，保证层层有依托"""
    masks = []
    below = np.zeros(h.shape, bool)
    below[MARGIN:-MARGIN, MARGIN:-MARGIN] = True
    for k in range(1, LEVELS + 1):
        below = clean((h > (k - 0.5) / LEVELS * 0.9) & below) & below
        masks.append(below)
    # 陡的景物会被切成一圈圈很窄的台阶，像等高线。贴着上一层、又窄于 MIN_TREAD 的台阶
    # 并进上一层，变成一整面高墙；宽的台阶（缓坡）保留。从下往上做，窄台阶会一路并到顶
    for k in range(LEVELS - 1):
        tread = masks[k] & ~masks[k + 1]
        narrow = tread & ~ndi.binary_opening(tread, disk(MIN_TREAD // 2))
        masks[k + 1] |= narrow & ndi.binary_dilation(masks[k + 1], disk(MIN_TREAD))
    return sum(m.astype(np.int32) for m in masks)


def walls(level_soft):
    """每层边缘的等值线，化简后存成 uv 坐标"""
    padded = np.pad(level_soft, 1)
    out = []
    for k in range(1, LEVELS + 1):
        for c in measure.find_contours(padded, k - 0.5):
            c = measure.approximate_polygon(c, 0.6)
            if len(c) < 4:
                continue
            u = (c[:, 1] - 0.5) / RES
            v = 1 - (c[:, 0] - 0.5) / RES
            out.append([k] + np.round(np.stack([u, v], 1) * 4096).astype(int).ravel().tolist())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse-depth", action="store_true")
    args = ap.parse_args()

    paper_colors = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "images", "*.jpg"))):
        name = os.path.splitext(os.path.basename(path))[0]
        im = Image.open(path).convert("RGB")
        color = im.resize((RES, RES), Image.LANCZOS)
        color.save(f"{OUT}/{name}-color.jpg", quality=86)

        if args.reuse_depth:
            depth = np.asarray(Image.open(f"{OUT}/{name}-relief.png"))[..., 0].astype(np.float32) / 255
        else:
            depth = estimate_depth(im)

        gray = np.asarray(color.convert("L"), np.float32) / 255
        level = layer(height(gray, depth))
        level_soft = ndi.gaussian_filter(level.astype(np.float32), 1.0)
        shade = ndi.gaussian_filter(level.astype(np.float32), 10)

        rgb = np.stack([depth, level_soft / LEVELS, shade / LEVELS], -1)
        Image.fromarray((rgb * 255).round().astype(np.uint8)).save(f"{OUT}/{name}-relief.png", optimize=True)
        contours = walls(level_soft)
        json.dump({"levels": LEVELS, "walls": contours}, open(f"{OUT}/{name}-walls.json", "w"), separators=(",", ":"))

        px = np.array(im.resize((256, 256)), np.float32).reshape(-1, 3)
        lum = px.mean(1)
        paper_colors[name] = [round(v) for v in np.median(px[lum > np.percentile(lum, 60)], 0)]

        area = [round((level >= k).mean() * 100) for k in range(1, LEVELS + 1)]
        print(name, "层面积%", area, "轮廓", len(contours), "顶点", sum(len(c) // 2 for c in contours))

    json.dump(paper_colors, open(f"{OUT}/paper.json", "w"))


if __name__ == "__main__":
    main()
