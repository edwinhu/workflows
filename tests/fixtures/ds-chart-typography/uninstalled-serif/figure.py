"""founder-ceo-ipo v2 figure script, reduced: loads paper.mplstyle and a serif nobody installed, saved at 600 dpi."""
from pathlib import Path

import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
plt.style.use(HERE / 'paper.mplstyle')  # A5: the project's one registered theme

fig, ax = plt.subplots(figsize=(8, 4.5))
ax.plot([1996, 2008, 2024], [0.4, 0.3, 0.5])
for ext in ('svg', 'png'):
    fig.savefig(HERE / f'fig_founder.{ext}', dpi=600)
