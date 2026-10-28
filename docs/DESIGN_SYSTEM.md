# Design system

MatchRadar is dark by default, with an optional light theme. Both use the same layout and semantic CSS variables in `src/styles.css`: panel RGB, text, muted text, accent, accent surfaces, card surfaces, and borders. Dark uses charcoal glass and lime; light uses pale green-white surfaces, ink text, and a deeper green accent. Avoid per-component color inversions or duplicated theme layouts.

Panel opacity ranges from 70% to 100%, defaulting to 96%. Apply it to the panel background, never the shell's CSS `opacity`, so text, controls, and crests stay opaque. Home, settings, and details share the same panel treatment. Cards retain stronger surfaces for legibility; verify contrast over bright and dark wallpapers at the lowest opacity.

Keep rounded corners, compact typography, tabular scores, and consistent badge/team/result alignment. The header contains branding and native minimize/hide controls; the footer contains Settings, pin, following filter, and refresh. Toggle buttons expose pressed state and match their Settings switches. Compact mode reduces the native window and layout together; it is not minimization.

Use one content scroll surface, fixed header/footer, visible keyboard focus, and reduced-motion support. Inspect home, Teams, Appearance, and details at 390px and the 320px minimum width, including the compact window. Check packaged Windows at 100%, 125%, and 150% scaling separately from browser layout checks.

The competition mark is an original inline crown/football shield illustration, not an official Premier League asset. It uses the theme accent and has no remote-image dependency. Club crests come from validated ESPN CDN URLs with a canonical stable-ID fallback, then initials if images fail. These provider-owned assets do not imply distribution rights; see `DATA_PROVIDER.md`.

Match cards have sibling details and notification buttons, never nested interactive buttons. Bell state is exposed with `aria-pressed`, a match-specific accessible name, and an explanatory tooltip. A ringing bell enables the match subscription; a struck bell means explicitly muted; an outline bell uses team defaults. Footer filtering uses a list-filter icon, a state tooltip, and an active dot. Date headings use semantic headings with clearer weight and a divider; the list states its approximate 14-day coverage. The expanded default remains 390×700 after inspection at 320px/390px; larger secondary labels and slightly roomier card actions improve legibility without a larger window.
