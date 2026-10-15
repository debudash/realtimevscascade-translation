# Design reference

Approved UI design, exported from the design tool as prototype HTML.

- `workbench-screen.html`: the main screen, with an interactive prototype. Its
  timings are simulated.
- `error-states.html`: one state per error code, plus floor deny and mode
  switch.
- `architecture-board.html`: the architecture at a glance.
- `boostlingo-logo.png`: transparent logo for the header.

These files use the design tool's templating (`{{...}}`, `<sc-if>`,
`<sc-for>`, `DCLogic`), so they won't render as plain HTML. Read them for
layout, copy, colors, and states, and build the real UI from
`docs/ui-spec.md`. Where they differ, the spec wins.
