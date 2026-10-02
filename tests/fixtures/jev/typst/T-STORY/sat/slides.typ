#import "templates/theme.typ": *

#show: university-theme.with(config-info(title: [Proxy Advisors and the Vote], qr: none))

= How a Vote Is Cast

== The Default Path

#slide[
  === Most institutional votes reach the issuer through one platform.
  #inv("F1")

  #align(center)[
    // Storytelling: Four nodes in a single left-to-right chain with no branch → a fund that does nothing still votes, because the default path has only one exit
    #fletcher-diagram(
      spacing: (2em, 2em),
      node-stroke: 1pt,
      node((0, 0), [Fund], name: <f>),
      node((1, 0), [ProxyExchange], name: <p>),
      node((2, 0), [Broadridge], name: <b>),
      node((3, 0), [Issuer], name: <i>),
      edge(<f>, <p>, "-|>"),
      edge(<p>, <b>, "-|>"),
      edge(<b>, <i>, "-|>"),
    )
  ]
]
