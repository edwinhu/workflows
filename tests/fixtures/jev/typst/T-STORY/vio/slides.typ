#import "templates/theme.typ": *

#show: university-theme.with(config-info(title: [Proxy Advisors and the Vote], qr: none))

= How a Vote Is Cast

== The Default Path

#slide[
  === Most institutional votes reach the issuer through one platform.
  #inv("F1")

  #align(center)[
    // Storytelling: Shows the different parties in the voting process
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
