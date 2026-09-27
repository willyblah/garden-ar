"""把 images/ 里的古画处理成网页用的素材。

依赖：pip install torch transformers pillow numpy scipy
用法：python tools/prep.py        （在项目根目录运行）

每张画输出两个文件到 assets/：
  N-color.jpg  原画（1024px）
  N-depth.png  R = 深度（越亮越近，用于雾气远近）
               G = 浮雕高度交界处（前后物体交界，渲染时挖空）
               B = 浮雕高度：压低整体地面坡度、突出树木亭台等景物，四边贴回纸面
另外把每张画的纸色写进 assets/paper.json，挖空处露出来的就是这个颜色。
"""
import glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage
from transformers import pipeline

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
DEPTH_RES = 512
CUT_THRESHOLD = 0.035  # 相邻像素深度差超过它就算交界

pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Base-hf")

paper_colors = {}
for path in sorted(glob.glob(os.path.join(ROOT, "images", "*.jpg"))):
    name = os.path.splitext(os.path.basename(path))[0]
    im = Image.open(path).convert("RGB")

    im.resize((1024, 1024), Image.LANCZOS).save(f"{OUT}/{name}-color.jpg", quality=86)

    d = pipe(im)["predicted_depth"].squeeze().numpy().astype(np.float32)
    d = np.array(Image.fromarray(d).resize((DEPTH_RES, DEPTH_RES), Image.BILINEAR))
    lo, hi = np.percentile(d, [1, 99])
    d = np.clip((d - lo) / (hi - lo), 0, 1)
    d = ndimage.median_filter(d, 3)

    ground = ndimage.gaussian_filter(ndimage.grey_opening(d, size=61), 8)
    relief = 0.45 * d + 0.9 * np.clip(d - ground, 0, None)
    relief /= np.percentile(relief, 99.5)
    ramp = np.clip(np.linspace(0, 1, DEPTH_RES) / 0.12, 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    ramp = np.minimum(ramp, ramp[::-1])
    relief = np.clip(relief, 0, 1) * np.minimum.outer(ramp, ramp)

    gx = ndimage.sobel(relief, axis=1) / 8
    gy = ndimage.sobel(relief, axis=0) / 8
    cut = np.hypot(gx, gy) > CUT_THRESHOLD
    cut = ndimage.binary_dilation(cut, iterations=2)

    rgb = np.zeros((DEPTH_RES, DEPTH_RES, 3), np.uint8)
    rgb[..., 0] = (d * 255).round()
    rgb[..., 1] = cut * 255
    rgb[..., 2] = (relief * 255).round()
    Image.fromarray(rgb).save(f"{OUT}/{name}-depth.png", optimize=True)

    px = np.array(im.resize((256, 256)), np.float32).reshape(-1, 3)
    lum = px.mean(1)
    paper_colors[name] = [round(v) for v in np.median(px[lum > np.percentile(lum, 60)], 0)]

    print(name, "cut%", round(cut.mean() * 100, 1), "paper", paper_colors[name])

json.dump(paper_colors, open(f"{OUT}/paper.json", "w"))
