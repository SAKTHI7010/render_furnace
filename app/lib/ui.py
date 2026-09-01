"""Shared UI helpers for SmartMelt Studio: theme, KPI cards, Plotly defaults,
and the coloured furnace cross-section (liquid metal, slag, solid scrap,
undissolved additions) that visualises the live state of the bath."""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import plotly.graph_objects as go
import streamlit as st

# palette (matches the operator console / deck)
INK = "#0d1013"
PANEL = "#151b21"
MOLT = "#e8622e"
MOLT_HI = "#ff8a4c"
STEEL = "#4fa8d8"
GREEN = "#33c17a"
AMBER = "#f5b301"
RED = "#e5484d"
MUT = "#8b93a1"
LINE = "#2a3138"

METAL_HOT = "#ff7a1a"   # molten iron (bright orange when hot)
METAL_MID = "#e24d0f"   # cooler melt (red-orange)
SLAG_COL = "#7d6b48"    # slag (distinct khaki, clearly above metal)
SLAG_TOP = "#a08a5a"    # slag highlight
SCRAP_COL = "#8792a0"   # cold solid charge (light steel-grey, reads on dark)
FLUX_COL = "#ece6d4"    # undissolved flux lumps (near-white)
LINING = "#4a3527"      # refractory (warm brown)
LINING_HL = "#5e4433"   # refractory highlight
COIL = "#c8802f"        # copper coil
CAVITY = "#1a1410"      # empty cavity (dark warm)


def inject_css():
    st.markdown(
        """
        <style>
        :root {
          --bg-deep:#0a0d10; --bg-panel:#12171b; --bg-raised:#182027;
          --line:#232c33; --text:#e9edf0; --text-mut:#9aa4af; --text-dim:#6b757f;
          --molten:#ff6a34; --molten-hi:#ffd166; --steel:#4fa8d8;
          --green:#33d17a; --amber:#f0a83c; --red:#e5484d;
        }
        /* base surfaces — cover EVERY Streamlit container incl. the header */
        .stApp, [data-testid="stAppViewContainer"], [data-testid="stMain"],
        .main, .block-container { background: #0a0d10 !important; color: #e9edf0 !important; }
        /* the header/toolbar that was rendering WHITE at the top */
        [data-testid="stHeader"], header[data-testid="stHeader"],
        [data-testid="stToolbar"], [data-testid="stDecoration"] {
          background: #0a0d10 !important; color: #e9edf0 !important;
        }
        [data-testid="stDecoration"] { display: none !important; }  /* rainbow bar */
        [data-testid="stSidebar"], section[data-testid="stSidebar"] > div {
          background: #12171b !important;
        }
        [data-testid="stSidebar"] * { color: #d4dae1 !important; }
        /* body text — bright, legible on the near-black background */
        .stApp, .stMarkdown, p, li, label, span,
        [data-testid="stMarkdownContainer"] { color: #e9edf0; }
        h1,h2,h3,h4 { color:#f4f7fa !important; letter-spacing:.2px; }
        [data-testid="stCaptionContainer"], .stCaption, small { color:#9aa4af !important; }
        code { color:#8fd0f0 !important; background:#12171b !important;
               padding:1px 5px; border-radius:4px; }
        /* KPI cards */
        .kpi { background:#182027; border:1px solid #232c33; border-radius:10px;
               padding:12px 14px; height:100%; }
        .kpi .lab { color:#9aa4af; font-size:12px; text-transform:uppercase;
                    letter-spacing:1px; margin-bottom:4px; }
        .kpi .val { color:#ff8a4c; font-size:26px; font-weight:700; line-height:1.15;
                    font-family:'DejaVu Sans',sans-serif; }
        .kpi .sub { color:#aab3bf; font-size:11px; margin-top:2px; }
        /* status pills — solid, high-contrast */
        .pill { display:inline-block; padding:4px 12px; border-radius:20px;
                font-size:12px; font-weight:700; border:1px solid transparent; }
        .ok  { background:rgba(51,209,122,.18); color:#5fe3a3; border-color:rgba(51,209,122,.45);}
        .warn{ background:rgba(240,168,60,.18); color:#ffc766; border-color:rgba(240,168,60,.45);}
        .bad { background:rgba(229,72,77,.20);  color:#ff8286; border-color:rgba(229,72,77,.5);}
        .muted{ color:#aab3bf; font-size:13px; }
        div[data-testid="stMetricValue"]{ color:#ff8a4c; }
        div[data-testid="stMetricLabel"]{ color:#9aa4af; }
        /* buttons */
        .stButton button { background:#182027; color:#e9edf0; border:1px solid #2c3742; }
        .stButton button:hover { border-color:#ff6a34; color:#ffd166; }
        </style>
        """,
        unsafe_allow_html=True,
    )


def kpi(label: str, value: str, sub: str = ""):
    st.markdown(
        f'<div class="kpi"><div class="lab">{label}</div>'
        f'<div class="val">{value}</div>'
        f'<div class="sub">{sub}</div></div>',
        unsafe_allow_html=True,
    )


def pill(text: str, kind: str = "ok") -> str:
    return f'<span class="pill {kind}">{text}</span>'


def style_fig(fig: go.Figure, height: int = 320, title: str = "",
              ylab: str = "", y2lab: str = "") -> go.Figure:
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="#0f1418",
        height=height,
        margin=dict(l=55, r=55 if y2lab else 15, t=34 if title else 12, b=38),
        title=dict(text=title, font=dict(size=14, color="#ecf0f3")) if title else None,
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0,
                    font=dict(size=11), bgcolor="rgba(0,0,0,0)"),
        font=dict(family="DejaVu Sans, sans-serif", size=12, color="#c6ccd4"),
    )
    fig.update_xaxes(gridcolor="#20262c", zeroline=False)
    fig.update_yaxes(gridcolor="#20262c", zeroline=False, title_text=ylab)
    if y2lab:
        fig.update_layout(yaxis2=dict(title=y2lab, overlaying="y", side="right",
                                      gridcolor="rgba(0,0,0,0)"))
    return fig


# ────────────────────────────────────────────────────────────────────────────
# Coloured furnace cross-section
# ────────────────────────────────────────────────────────────────────────────
def furnace_svg(
    melted_pct: float,
    T_bath_C: float,
    slag_kg: float,
    undissolved_kg: float,
    heat_size_t: float = 12.0,
    tap_aim_C: float = 1620.0,
    height: int = 360,
) -> str:
    """
    Return an SVG string: a coreless induction furnace cut-away showing the
    liquid-metal level, a slag cap, remaining solid scrap, floating undissolved
    flux lumps, the refractory lining and the copper coil. Colours shift with
    bath temperature so the operator reads the state at a glance.
    """
    melted = max(0.0, min(1.0, melted_pct / 100.0))
    # interior geometry (viewBox 0..260 x, 0..270 y; y down). Wider crucible,
    # room on the right for level labels.
    x0, x1 = 52, 150          # crucible inner walls
    top, bot = 46, 224        # inner cavity top/bottom
    cav_h = bot - top
    xr = x1 + 20              # label anchor x

    # metal colour by temperature: cool -> deep red, hot -> bright orange-gold.
    frac = max(0.0, min(1.0, (T_bath_C - 1150.0) / (tap_aim_C + 40.0 - 1150.0)))
    r = int(196 + 59 * frac)
    g = int(46 + 130 * frac)
    b = int(12 + 26 * frac)
    metal_fill = f"rgb({r},{g},{b})"
    metal_lite = f"rgb({min(r+30,255)},{min(g+50,255)},{min(b+30,120)})"
    glow = 0.20 + 0.40 * frac

    # levels: liquid fills from the bottom in proportion to melted fraction
    usable = cav_h * 0.90
    liq_h = usable * melted
    liq_top = bot - liq_h
    slag_h = min(18, 6 + slag_kg / 10.0) if (slag_kg > 0 and liq_h > 3) else 0
    slag_top = liq_top - slag_h
    solid_bot = slag_top if slag_h > 0 else liq_top
    solid_h = usable * (1 - melted)
    solid_top = max(top + 3, solid_bot - solid_h)

    # undissolved flux lumps float at the slag/metal interface
    lumps = ""
    if undissolved_kg > 1 and liq_h > 8:
        n = int(min(9, 1 + undissolved_kg / 10.0))
        rng = np.random.default_rng(int(undissolved_kg))
        lo_y, hi_y = liq_top + 3, min(bot - 6, liq_top + 26)
        if hi_y > lo_y:
            for _ in range(n):
                cx = rng.uniform(x0 + 8, x1 - 8)
                cy = rng.uniform(lo_y, hi_y)
                rr = rng.uniform(3, 5.5)
                lumps += (f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{rr:.0f}" '
                          f'fill="{FLUX_COL}" stroke="#b7ae95" stroke-width="0.6"/>')

    # solid scrap chunks (only while unmelted)
    scrap = ""
    if melted < 0.985 and (solid_bot - solid_top) > 6:
        rng = np.random.default_rng(7)
        n = int(8 + 16 * (1 - melted))
        for _ in range(n):
            cx = rng.uniform(x0 + 5, x1 - 12)
            cy = rng.uniform(solid_top + 3, solid_bot - 3)
            w = rng.uniform(7, 14); h = rng.uniform(5, 10)
            rot = rng.uniform(-25, 25)
            scrap += (f'<rect x="{cx:.0f}" y="{cy:.0f}" width="{w:.0f}" height="{h:.0f}" '
                      f'rx="1.5" fill="{SCRAP_COL}" stroke="#69727e" stroke-width="0.5" '
                      f'transform="rotate({rot:.0f} {cx:.0f} {cy:.0f})"/>')

    # coil turns down both sides
    coils = ""
    for yy in range(top + 4, bot, 16):
        coils += (f'<rect x="{x0-24}" y="{yy}" width="12" height="10" rx="3" fill="{COIL}"/>'
                  f'<rect x="{x1+12}" y="{yy}" width="12" height="10" rx="3" fill="{COIL}"/>')

    liq_rect = ""
    if liq_h > 1:
        liq_rect = (
            f'<rect x="{x0}" y="{liq_top:.0f}" width="{x1-x0}" height="{bot-liq_top:.0f}" '
            f'fill="{metal_fill}"/>'
            # bright surface band so the metal level is unmistakable
            f'<rect x="{x0}" y="{liq_top:.0f}" width="{x1-x0}" height="4" fill="{metal_lite}"/>')
    slag_rect = ""
    if slag_h > 0:
        slag_rect = (
            f'<rect x="{x0}" y="{slag_top:.0f}" width="{x1-x0}" height="{slag_h:.0f}" fill="{SLAG_COL}"/>'
            f'<rect x="{x0}" y="{slag_top:.0f}" width="{x1-x0}" height="3" fill="{SLAG_TOP}"/>')

    # ---- level callout labels on the right ----
    def label(y, txt, col):
        yy = max(top + 6, min(bot - 4, y))
        return (f'<line x1="{x1}" y1="{yy:.0f}" x2="{xr-2}" y2="{yy:.0f}" '
                f'stroke="{col}" stroke-width="0.8" opacity="0.7"/>'
                f'<text x="{xr}" y="{yy+3:.0f}" fill="{col}" font-size="8.5" '
                f'font-family="DejaVu Sans">{txt}</text>')

    labels = ""
    if liq_h > 3:
        labels += label((liq_top + bot) / 2, f"metal {melted*100:.0f}%", "#ffb066")
    if slag_h > 0:
        labels += label(slag_top + slag_h / 2, "slag", SLAG_TOP)
    if melted < 0.985 and (solid_bot - solid_top) > 8:
        labels += label((solid_top + solid_bot) / 2, "scrap", "#aab3bf")
    if undissolved_kg > 1 and liq_h > 8:
        labels += label(liq_top + 8, f"flux {undissolved_kg:.0f}kg", FLUX_COL)

    # temperature badge (top-left, always readable)
    badge_col = "#ffb066" if frac > 0.5 else "#e07a4a"

    svg = f"""
    <svg viewBox="0 0 260 270" width="100%" height="{height}"
         xmlns="http://www.w3.org/2000/svg" style="background:#0e1216;border-radius:10px;">
      <defs>
        <radialGradient id="glow" cx="50%" cy="82%" r="65%">
          <stop offset="0%" stop-color="rgb({r},{g},{b})" stop-opacity="{glow:.2f}"/>
          <stop offset="100%" stop-color="rgb({r},{g},{b})" stop-opacity="0"/>
        </radialGradient>
      </defs>
      {coils}
      <!-- refractory shell -->
      <rect x="{x0-13}" y="{top-16}" width="{x1-x0+26}" height="{cav_h+34}" rx="11"
            fill="{LINING}" stroke="#2b1d13" stroke-width="2"/>
      <rect x="{x0-13}" y="{top-16}" width="4" height="{cav_h+34}" fill="{LINING_HL}" opacity="0.6"/>
      <!-- cavity -->
      <rect x="{x0}" y="{top}" width="{x1-x0}" height="{cav_h}" fill="{CAVITY}"/>
      {liq_rect}
      {slag_rect}
      {scrap}
      {lumps}
      <rect x="{x0}" y="{top}" width="{x1-x0}" height="{cav_h}" fill="url(#glow)"/>
      <!-- lip -->
      <rect x="{x0-15}" y="{top-18}" width="{x1-x0+30}" height="7" rx="3" fill="#5e4433"/>
      <!-- temperature badge -->
      <rect x="{x0-8}" y="14" width="86" height="22" rx="5" fill="#151b21" stroke="#2a3138"/>
      <text x="{x0-2}" y="29" fill="{badge_col}" font-size="13" font-weight="bold"
            font-family="DejaVu Sans">{T_bath_C:.0f} °C</text>
      <text x="{x0+52}" y="29" fill="#8b93a1" font-size="8" font-family="DejaVu Sans">bath</text>
      <!-- level labels -->
      {labels}
      <!-- caption -->
      <text x="{(x0+x1)/2:.0f}" y="{bot+30}" fill="#8b93a1" font-size="8.5" text-anchor="middle"
            font-family="DejaVu Sans">coreless induction · {heat_size_t:.0f} t · aim {tap_aim_C:.0f} °C</text>
    </svg>
    """
    return svg


def legend_row() -> str:
    items = [("Molten metal", METAL_HOT), ("Slag", SLAG_COL),
             ("Solid scrap", SCRAP_COL), ("Undissolved flux", FLUX_COL),
             ("Refractory", LINING), ("Coil", COIL)]
    chips = "".join(
        f'<span style="display:inline-flex;align-items:center;margin-right:14px;'
        f'font-size:12px;color:#c6ccd4;">'
        f'<span style="width:12px;height:12px;border-radius:3px;background:{c};'
        f'display:inline-block;margin-right:5px;"></span>{name}</span>'
        for name, c in items
    )
    return f'<div style="margin-top:6px;">{chips}</div>'
