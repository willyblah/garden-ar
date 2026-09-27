# 拙政园 · 画中游

用手机摄像头对准文徵明《拙政园图》中的任意一幅，画面会从纸上浮起成立体浮雕。底部可以切换时辰和季节；默认跟随当前的真实时间和季节。

## 运行

```bash
python3 -m http.server 8000
```

- 电脑上预览（不用相机）：<http://localhost:8000/?preview>
- 手机使用相机必须是 https 地址，部署到 GitHub Pages 等静态托管即可，整个文件夹原样上传。二维码指向部署后的网址。

## 识别对象

印刷或在屏幕上显示 `images/` 里的原图（不要裁剪、不要加边框以外的改动），卡片、海报、屏幕都可以。印刷尺寸建议 10cm 以上。

## 目录

| 路径 | 内容 |
|---|---|
| `index.html`、`js/` | 页面和程序（three.js + MindAR） |
| `assets/` | 由原画生成的素材：原画、深度/浮雕图、纸色 |
| `targets.mind` | MindAR 识别文件，由 5 张原画编译 |
| `vendor/` | three.js 0.160、MindAR 1.2.5，放在本地以免 CDN 访问不稳 |
| `tools/` | 重新生成素材和识别文件的工具 |

## 更换或增加古画

1. 把图片放进 `images/`（按 1.jpg、2.jpg… 编号）。
2. 生成素材：`pip install torch transformers pillow numpy scipy`，然后 `python tools/prep.py`。
3. 打开 <http://localhost:8000/tools/compile.html> 编译，把下载的 `targets.mind` 放到根目录。
4. 在 `js/painting.js` 的 `PAINTINGS` 里给新画加一项（夜里亮灯的位置）；数量变了的话同时改 `tools/compile.html` 里的 `COUNT`。
