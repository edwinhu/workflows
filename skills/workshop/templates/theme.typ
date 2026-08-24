// Workshop presentation theme
// Minimal Touying university theme for academic workshop presentations.
// Stripped from the full secreg theme — no course-specific features.

#import "@preview/touying:0.5.3": *
#import "custom-outline.typ": custom-outline
#import "@preview/showybox:2.0.1" as mod-showybox
#import "@preview/numbly:0.1.0": numbly
// for drawings
#import "@preview/cetz:0.3.2"
// for diagrams
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
// cetz and fletcher bindings for touying
#let cetz-canvas = touying-reducer.with(reduce: cetz.canvas, cover: cetz.draw.hide.with(bounds: true))
#let fletcher-diagram = touying-reducer.with(reduce: fletcher.diagram, cover: fletcher.hide)

// ── Colors ──────────────────────────────────────────────────────────────
// UVA brand palette (override these for other institutions)
#let uva-blue = rgb("#232D4B")
#let uva-orange = rgb("#E57200")
#let orange-cb = rgb("#FFC20A")
#let blue-cb = rgb("#0C7BDC")
#let green-cb = rgb("#004D40")

#let primary-color = black
#let secondary-color = uva-blue
#let tertiary-color = uva-orange
#let text-color = black

// ── Utility functions ───────────────────────────────────────────────────

#let todo(content: text(style: "oblique")[TODO]) = box(stroke: 2pt + red, content)

// Source Inventory declaration. Renders nothing: it exists so a slide states, in its own source,
// which inventory IDs it draws on, which is what INV greps for.
#let inv(..ids) = none

#let large-center-text(content) = [
  #set text(72pt)
  #set align(center)
  #content
]

// ── Showybox / definition ───────────────────────────────────────────────

#let showybox-frame-style = (
  title-color: secondary-color.lighten(25%),
  body-color: secondary-color.transparentize(80%),
  border-color: color.luma(100%, 0%),
)
#let showybox = mod-showybox.showybox.with(
  frame: showybox-frame-style,
  body-style: (color: text-color),
)
#let definition(of-thing, content) = {
  showybox(
    frame: showybox-frame-style + (border-color: primary-color),
    title-style: (boxed-style: (anchor: (y: horizon, x: center))),
    title: of-thing.replace(regex("^\w"), m => upper(m.text)),
    {
      show of-thing: v => underline[*#v*]
      content
    }
  )
}

// ── Slide functions ─────────────────────────────────────────────────────

#let slide(
  config: (:),
  repeat: auto,
  setting: body => body,
  composer: auto,
  ..bodies,
) = touying-slide-wrapper(self => {
  let header(self) = {
    set align(top)
    grid(
      rows: (auto, auto),
      row-gutter: 3mm,
      if self.store.progress-bar {
        components.progress-bar(height: 2pt, self.colors.primary, self.colors.tertiary)
      },
      block(
        inset: (x: .5em),
        components.left-and-right(
          text(fill: self.colors.primary, weight: "bold", size: 1.2em, utils.call-or-display(self, self.store.header)),
          text(fill: self.colors.primary.lighten(65%), utils.call-or-display(self, self.store.header-right)),
        ),
      ),
    )
  }
  let footer(self) = {
    set align(center + bottom)
    set text(size: .4em)
    {
      let cell(..args, it) = components.cell(
        ..args,
        inset: 1mm,
        align(horizon, text(fill: white, it)),
      )
      show: block.with(width: 100%, height: auto)
      grid(
        columns: self.store.footer-columns,
        rows: 1.5em,
        cell(fill: self.colors.secondary, utils.call-or-display(self, self.store.footer-a)),
        cell(fill: self.colors.secondary, utils.call-or-display(self, self.store.footer-b)),
        cell(fill: self.colors.secondary, utils.call-or-display(self, self.store.footer-c)),
      )
    }
  }
  let self = utils.merge-dicts(
    self,
    config-page(header: header, footer: footer),
  )
  touying-slide(self: self, config: config, repeat: repeat, setting: setting, composer: composer, ..bodies)
})

#let title-slide(
  extra: none,
  ..args,
) = touying-slide-wrapper(self => {
  let info = self.info + args.named()
  info.authors = {
    let authors = if "authors" in info { info.authors } else { info.author }
    if type(authors) == array { authors } else { (authors,) }
  }
  let body = {
    if info.logo != none {
      place(right, text(fill: self.colors.primary, info.logo))
    }
    if info.qr != none {
      place(bottom + left, text(fill: self.colors.primary, info.qr))
    }
    align(center + horizon, {
      block(inset: 0em, breakable: false, {
        text(size: 2em, fill: self.colors.primary, strong(info.title))
        if info.subtitle != none {
          parbreak()
          text(size: 1.2em, fill: self.colors.primary, info.subtitle)
        }
      })
      set text(size: .8em)
      grid(
        columns: (1fr,) * calc.min(info.authors.len(), 3),
        column-gutter: 1em,
        row-gutter: 1em,
        ..info.authors.map(author => text(fill: self.colors.neutral-darkest, author))
      )
      v(1em)
      if info.institution != none {
        parbreak()
        text(size: .9em, info.institution)
      }
      if info.date != none {
        parbreak()
        text(size: .8em, utils.display-info-date(self))
      }
    })
  }
  self = utils.merge-dicts(
    self,
    config-common(freeze-slide-counter: true),
    config-page(fill: self.colors.neutral-lightest),
  )
  touying-slide(self: self, body)
})

#let new-section-slide(level: 1, numbered: true, body) = touying-slide-wrapper(self => {
  let slide-body = {
    set align(horizon)
    show: pad.with(left: 15%, right: 15%)
    custom-outline(
      title: none,
      filter: hd => hd.relation != none and not hd.relation.unrelated,
      depth: 2,
      transform: (hd, it) => {
        set text(size: 1.25em, fill: self.colors.primary, weight: "bold") if hd.relation != none and hd.relation.same
        set text(fill: self.colors.primary) if hd.relation != none and hd.relation.child
        set text(fill: text.fill.transparentize(60%)) if hd.relation != none and hd.relation.sibling
        it
      }
    )
    body
  }
  self = utils.merge-dicts(
    self,
    config-page(fill: self.colors.neutral-lightest),
  )
  touying-slide(self: self, slide-body)
})

#let focus-slide(background-color: none, background-img: none, body) = touying-slide-wrapper(self => {
  let background-color = if background-img == none and background-color == none {
    rgb(self.colors.primary)
  } else {
    background-color
  }
  let args = (:)
  if background-color != none { args.fill = background-color }
  if background-img != none {
    args.background = {
      set image(fit: "stretch", width: 100%, height: 100%)
      background-img
    }
  }
  self = utils.merge-dicts(
    self,
    config-common(freeze-slide-counter: true),
    config-page(margin: 1em, ..args),
  )
  set text(fill: self.colors.neutral-lightest, weight: "bold", size: 2em)
  touying-slide(self: self, align(horizon, body))
})

#let matrix-slide(columns: none, rows: none, ..bodies) = touying-slide-wrapper(self => {
  self = utils.merge-dicts(
    self,
    config-common(freeze-slide-counter: true),
    config-page(margin: 0em),
  )
  touying-slide(self: self, composer: components.checkerboard.with(columns: columns, rows: rows), ..bodies)
})

// ── Main theme ──────────────────────────────────────────────────────────

#let university-theme(
  aspect-ratio: "16-9",
  progress-bar: true,
  header: utils.display-current-heading(level: 2),
  header-right: self => self.info.logo,
  footer-columns: (25%, 1fr, 25%),
  footer-a: self => self.info.author,
  footer-b: self => if self.info.short-title == auto {
    self.info.title
  } else {
    self.info.short-title
  } + " – " + utils.display-current-heading(level: 1),
  footer-c: self => {
    h(1fr)
    utils.display-info-date(self)
    h(1fr)
    context utils.slide-counter.display() + " / " + utils.last-slide-number
    h(1fr)
  },
  handout: false,
  ..args,
  body,
) = {
  show: touying-slides.with(
    config-page(
      paper: "presentation-" + aspect-ratio,
      header-ascent: 0em,
      footer-descent: 0em,
      margin: (top: 2em, bottom: 1.25em, x: 2em),
    ),
    config-common(
      slide-fn: slide,
      new-section-slide-fn: new-section-slide,
      handout: handout,
    ),
    config-methods(
      init: (self: none, body) => {
        set text(fill: self.colors.neutral-darkest, size: 22pt)
        show heading: set text(fill: self.colors.primary)
        body
      },
      alert: utils.alert-with-primary-color,
    ),
    config-colors(
      primary: primary-color,
      secondary: secondary-color,
      tertiary: tertiary-color,
      neutral-lightest: rgb("#ffffff"),
      neutral-darkest: text-color,
    ),
    config-store(
      progress-bar: progress-bar,
      header: header,
      header-right: header-right,
      footer-columns: footer-columns,
      footer-a: footer-a,
      footer-b: footer-b,
      footer-c: footer-c,
    ),
    ..args,
  )
  body
}

// ── Headline card (LWT-style) ───────────────────────────────────────────

// Editorial recreation: per-venue paper stock, real masthead logo, top rule +
// category kicker, a serif headline with a Last-Week-Tonight yellow highlighter
// swipe over a key phrase, and a short standfirst. X/Twitter is a VENUE here,
// not a second function -- it takes the same card with the newspaper chrome off.
//   phrase:  substring of `headline` to highlight (curly quotes must match)
//   kicker:  small category tag, e.g. "MARKETS" (optional)
//   logo:    DARK / full-colour logo for a light card (not the -white variant)
//   stock:   per-card paper override; `auto` takes the venue's own stock
//   handle:  account name for a social venue, e.g. "@elonmusk"
#let headline-card(
  venue: "",
  date: "",
  headline: "",
  quote: none,
  logo: none,
  phrase: none,
  kicker: none,
  stock: auto,
  handle: none,
  name: none,
  avatar: none,
) = {
  let ink = rgb("#16161c")
  let mute = rgb("#6a6458")
  // X light mode: #536471 secondary text, #cfd9de dividers and border.
  let x-mute = rgb("#536471")
  let x-rule = rgb("#cfd9de")
  let hl-yellow = rgb("#ffe000")
  let serif = "Libertinus Serif"
  let sans = "Noto Sans"

  // Paper stock is per publication. FT is famously salmon, the broadsheets are
  // white, and X in light mode is a white surface with a black mark; one
  // generic cream for everything reads as wrong to anyone who knows the outlet.
  // Unlisted venues keep the neutral cream.
  let stocks = (
    "Financial Times":     rgb("#FFF1E5"),
    "FT":                  rgb("#FFF1E5"),
    "WSJ":                 rgb("#FFFFFF"),
    "Wall Street Journal": rgb("#FFFFFF"),
    "NY Times":            rgb("#FFFFFF"),
    "New York Times":      rgb("#FFFFFF"),
    "NYT":                 rgb("#FFFFFF"),
    "Bloomberg":           rgb("#FFFFFF"),
    "ABC News":            rgb("#FFFFFF"),
    "X":                   rgb("#FFFFFF"),
    "Twitter":             rgb("#FFFFFF"),
    "Bluesky":             rgb("#FFFFFF"),
    "Mastodon":            rgb("#FFFFFF"),
    "Threads":             rgb("#FFFFFF"),
    "LinkedIn":            rgb("#FFFFFF"),
  )
  let newsprint = if stock != auto { stock } else { stocks.at(venue, default: rgb("#F7F4EC")) }

  // A post is not a clipping. X keeps the card — same stock table, same mark
  // normalization, same frame — but drops the chrome that only a newspaper
  // has: the heavy top rule, the category kicker, the serif headline face and
  // the highlighter swipe. What is left is the mark, the account, the post
  // text and its date.
  // Every microblog embed has the SAME shape — avatar + name over handle left,
  // mark top right, timestamp under the text. Only the mark and the accent
  // differ, and the handle format is data, not code (@user, @user.bsky.social,
  // @user@instance). So this is a venue LIST, not three branches.
  let is-post = venue in ("X", "Twitter", "Bluesky", "Mastodon", "Threads", "LinkedIn")
  // Fallback mark when no logo asset is supplied. Verified brand colours:
  // Bluesky #01A5FF, Mastodon #563ACC. X's mark is black.
  let post-mark = (
    "X":        ("X",  rgb("#16161c")),
    "Twitter":  ("X",  rgb("#16161c")),
    "Bluesky":  ("b.", rgb("#01A5FF")),
    "Mastodon": ("m",  rgb("#563ACC")),
    "Threads":  ("@",  rgb("#16161c")),
    "LinkedIn": ("in", rgb("#0A66C2")),
  )
  // The real X mark, inline. The glyph fallbacks above are stand-ins; this one
  // is the actual logo path, so an X card needs no asset shipped beside it. A
  // caller-supplied `logo` still wins.
  let x-mark-svg = "<svg width=\"300\" height=\"271\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m236 0h46l-101 115 118 156h-92.6l-72.5-94.8-83 94.8h-46l107-123-113-148h94.9l65.5 86.6zm-16.1 244h25.5l-165-218h-27.4z\"/></svg>"
  // Official brand marks, inline, so no deck has to ship an asset. Paths are the
  // simple-icons set (MIT) and the fill is each platform's own colour. A
  // caller-supplied `logo` still wins over all of these.
  let post-mark-svg = (
    "X":       x-mark-svg,
    "Twitter": x-mark-svg,
    "Bluesky": "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"#01A5FF\" d=\"M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026\"/></svg>",
    "Mastodon": "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"#563ACC\" d=\"M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12z\"/></svg>",
    "Threads": "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"#16161c\" d=\"M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z\"/></svg>",
    "LinkedIn": "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"#0A66C2\" d=\"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z\"/></svg>",
  )

  // Headline content with the key phrase swiped in highlighter yellow. Using an
  // inline highlight() means the swipe tracks the real glyphs and survives any
  // line-wrap — no pixel coordinates to maintain.
  let headline-content = [#headline]
  // `.contains` is a string method: a content headline has no swipe to place.
  if not is-post and phrase != none and phrase != "" and std.type(headline) == str and headline.contains(phrase) {
    let parts = headline.split(phrase)
    headline-content = [#parts.first()#highlight(
        fill: hl-yellow.transparentize(32%), extent: 2pt,
        top-edge: "bounds", bottom-edge: "bounds")[#phrase]#parts.slice(1).join(phrase)]
  }

  // Right-hand masthead meta (kicker over dateline), only what's present.
  // A post carries no category kicker — it was never filed under a desk.
  let meta = ()
  if not is-post and kicker != none and kicker != "" {
    meta.push(text(size: 12pt, weight: "bold", tracking: 1.5pt, fill: ink, upper(kicker)))
  }
  if date != "" {
    meta.push(text(
      font: if is-post { sans } else { serif },
      size: 12pt, weight: "medium", fill: mute, date))
  }

  // Auto-height card centered in the slide body so it never runs into the
  // footer / institutional logo (height: 1fr filled the whole slide before).
  // A post is not a clipping, so it does not get the masthead layout. A real X
  // embed reads: avatar + display name over @handle at the LEFT, the mark at the
  // TOP RIGHT, the post text at reading size, and the timestamp BELOW the text
  // over a hairline. The newspaper card puts the mark left and the date top
  // right — which is what made this read as a clipping OF a tweet rather than a
  // tweet.
  if is-post {
    block(width: 100%, height: 1fr, align(center + horizon,
      block(width: 90%, fill: newsprint, radius: 1em, inset: 1.6em,
        stroke: 0.5pt + x-rule, {
        set text(fill: ink, font: sans)
        align(left, block(width: 100%, {
          grid(columns: (auto, 1fr, auto), align: (left + horizon, left + horizon, right + top),
            {
              if avatar != none {
                box(clip: true, radius: 50%, height: 2.6em, width: 2.6em,
                  image(avatar, height: 2.6em, width: 2.6em, fit: "cover"))
                h(0.7em)
              }
            },
            {
              // Name over handle. With no display name the handle carries the
              // slot alone rather than leaving a bold gap.
              if name != none and name != "" {
                stack(dir: ttb, spacing: 0.32em,
                  text(size: 17pt, weight: "bold", fill: ink, name),
                  text(size: 15pt, weight: "regular", fill: x-mute, handle))
              } else if handle != none and handle != "" {
                text(size: 17pt, weight: "bold", fill: ink, handle)
              }
            },
            {
              // The mark, top right. A supplied logo wins; otherwise set the X
              // glyph heavy enough to read as the mark rather than as a letter.
              if logo != none { box(baseline: 0pt, image(logo, height: 1.5em)) }
              else if venue in post-mark-svg {
                box(baseline: 0pt,
                  image(bytes(post-mark-svg.at(venue)), format: "svg", height: 1.55em))
              } else {
                let m = post-mark.at(venue, default: ("", ink))
                text(size: 22pt, weight: "bold", fill: m.at(1), m.at(0))
              }
            })
          v(1.0em)
          set par(leading: 0.62em)
          text(size: 21pt, weight: "regular", headline-content)
          if quote != none {
            v(0.7em)
            set par(leading: 0.72em)
            text(size: 15pt, fill: x-mute, quote)
          }
          if date != "" {
            v(0.9em)
            text(size: 14pt, fill: x-mute, date)
            v(0.7em)
            line(length: 100%, stroke: 0.5pt + x-rule)
          }
        }))
      })
    ))
  } else {
  block(width: 100%, height: 1fr, align(center + horizon,
    block(width: 90%, fill: newsprint, radius: 0.3em, inset: 1.8em,
      stroke: 0.5pt + rgb("#ded7c7"), {
      set text(fill: ink)
      align(left, block(width: 100%, {
        if not is-post {
          line(length: 100%, stroke: 2pt + ink)
          v(0.6em)
        }
        // Masthead row: real logo (or venue wordmark) left, kicker/dateline right.
        // On a post the same slot carries the mark and the account handle.
        grid(columns: (1fr, auto), align: (left + horizon, right + horizon),
          {
            if logo != none {
              // Equal-area normalization: size each logo by its aspect ratio so a
              // narrow mark (ABC, ~2.8:1) and a wide wordmark (FT, ~12:1) carry
              // similar visual weight instead of one rendering tiny at fixed height.
              context {
                let nat = measure(image(logo))
                let ratio = nat.width / nat.height
                let mark-h = calc.max(1.1, calc.min(2.4, calc.sqrt(15.0 / ratio)))
                box(baseline: 0pt, image(logo, height: mark-h * 1em))
              }
            } else {
              text(font: serif, weight: "bold", size: 21pt, tracking: 0.3pt, upper(venue))
            }
            if handle != none and handle != "" {
              h(0.55em)
              text(font: sans, weight: "medium", size: 17pt, fill: mute, handle)
            }
          },
          stack(dir: ttb, spacing: 0.4em, ..meta),
        )
        v(1.2em)
        // Headline — the newspaper's serif, or a post's plain sans at reading
        // weight; post text is not a headline and should not be set as one.
        set par(leading: if is-post { 0.55em } else { 0.42em })
        text(
          font: if is-post { sans } else { serif },
          weight: if is-post { "regular" } else { "bold" },
          size: if is-post { 26pt } else { 28pt },
          headline-content)
        // Standfirst — lighter, looser, short
        if quote != none {
          v(0.9em)
          set par(leading: 0.72em)
          text(font: if is-post { sans } else { serif }, size: 16pt, fill: mute, quote)
        }
      }))
    })
  ))
  }
}

// ── Callout box ─────────────────────────────────────────────────────────

#let callout(body, marker: [#emoji.lightbulb]) = {
  rect(width: 100%, fill: gray.lighten(50%), radius: 0.5em, inset: 1em)[
    #set list(marker: [#marker])
    - #body
  ]
}

// ── Overflow detection ──────────────────────────────────────────────────

#let slide-body-width = 750pt
#let slide-body-height = 395pt

#let check-fit(body) = context {
  let size = measure(body, width: slide-body-width)
  let overflow = size.height - slide-body-height
  if overflow > 0pt {
    [
      #rect(fill: rgb("#ffcccc"), stroke: 2pt + red, width: 100%, inset: 0.5em)[
        #text(fill: red, weight: "bold")[Warning: SLIDE OVERFLOW: #calc.round(overflow.pt(), digits: 1)pt]
        #linebreak()
        #text(size: 0.8em)[
          Content exceeds slide by #calc.round(overflow.pt(), digits: 1)pt (#calc.round(overflow.pt() / slide-body-height.pt() * 100, digits: 0)%).
          #linebreak()
          Fix: `\#set text(#calc.round(22 * slide-body-height.pt() / size.height.pt(), digits: 0)pt)` or split content.
        ]
      ]
    ]
  }
  body
}
