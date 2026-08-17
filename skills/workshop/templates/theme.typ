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

#let headline-card(
  venue: "",
  date: "",
  headline: [],
  quote: none,
  logo: none,
) = {
  let badge-red = rgb("#c81e1e")
  let card-bg = rgb("#12121e")
  let card-fg = white
  let divider = rgb("#505064")

  block(width: 100%, height: 1fr, fill: card-bg, radius: 0.4em, inset: 1.5em, {
    set text(fill: card-fg)
    if date != "" {
      place(top + left,
        rect(fill: badge-red, radius: 1em, inset: (x: 0.7em, y: 0.3em))[
          #text(size: 14pt, weight: "bold", upper(date))
        ]
      )
    }
    align(center + horizon, {
      if logo != none {
        box(width: 60%, height: 4.5em, image(logo, fit: "contain", width: 100%, height: 100%))
      } else {
        text(size: 24pt, weight: "bold", tracking: 0.1em, fill: rgb("#c8c8d2"), upper(venue))
      }
      v(0.6em)
      line(length: 50%, stroke: 0.5pt + divider)
      v(0.6em)
      text(size: 22pt, weight: "bold", headline)
      if quote != none {
        v(0.6em)
        line(length: 50%, stroke: 0.5pt + divider)
        v(0.6em)
        text(size: 18pt, style: "italic", [\u{201c}] + quote + [\u{201d}])
      }
    })
  })
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
