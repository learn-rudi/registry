# Video Intake Separates Routing and Disposition

Status: accepted

Every source enters VP-0, where source ownership, disposition, and technical
classification are recorded as separate axes. Story-owned sources are filed in
their canonical topic before run initialization and registered once; only
keeper, production-intended sources continue through VP-1 and VP-2, while
disposable and reference sources may exit.

This separation prevents `story` from competing with `keeper` even though a
source can be both. It trades a richer intake contract for unambiguous routing,
traceable custody, and classification values that describe media rather than
business intent.

The accepted contract calls for a standard structured intake artifact. The
current stack does not enforce that artifact for every run, and generated
`about.md` is presentation rather than authoritative intake evidence.
