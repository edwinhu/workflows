# Render Commands Reference

Quick reference for rendering visual output to PNG for verification.

## Typst (tinymist)

### Single Page
```bash
tinymist compile input.typ /tmp/visual-verify.png --pages 1 --ppi 288
```

### Specific Page
```bash
tinymist compile input.typ /tmp/visual-verify.png --pages 3 --ppi 288
```

### Test Slide (isolated)
Create a test file in the project directory (required for theme imports):
```bash
cat > output/test-slide.typ << 'EOF'
#import "../templates/theme.typ": *
#show: university-theme.with(
  aspect-ratio: "16-9",
  config-info(title: [Test], author: [Test]),
)
#slide[
// Paste slide content here
]
EOF

typst compile --root . output/test-slide.typ /tmp/visual-verify.png --ppi 288
```

## Python (matplotlib / seaborn)

### Script saves to file
```bash
python3 script.py
# Script must contain: plt.savefig("/tmp/visual-verify.png", dpi=150, bbox_inches="tight")
```

### Inline save
```python
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
# ... plotting code ...
fig.savefig("/tmp/visual-verify.png", dpi=150, bbox_inches="tight")
plt.close(fig)
```

### Plotly (static export)
```python
import plotly.graph_objects as go
fig = go.Figure(...)
fig.write_image("/tmp/visual-verify.png", width=1200, height=800, scale=2)
```

## macOS Screenshots

### Full screen
```bash
screencapture -x /tmp/visual-verify.png
```

### Window (interactive selection)
```bash
screencapture -xw /tmp/visual-verify.png
```

### Region (interactive selection)
```bash
screencapture -xs /tmp/visual-verify.png
```

## Browser (Playwright)

```bash
npx playwright screenshot --viewport-size="1280,720" http://localhost:3000 /tmp/visual-verify.png
```

## Custom

Any command that produces a PNG at a known path. The key requirements:
1. Output path must be known before the command runs
2. Command must produce a PNG (or JPEG/WebP -- look-at supports these)
3. Exit code 0 on success, non-zero on failure
