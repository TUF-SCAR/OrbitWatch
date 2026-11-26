# OrbitWatch development instructions

The desktop UI is permanently frozen. Preserve its layout, panel dimensions and positions, typography, colours, spacing, controls, icons, animation, navigation, scrolling, legends, cards, globe and camera framing, robot placement, and interactions unless the user explicitly authorizes a desktop UI change.

Keep mobile UI changes within OrbitWatch's phone layout. Before changing shared frontend code or styles for a mobile repair, capture desktop baselines at 1366 × 768, 1600 × 900, and 1920 × 1080. Compare the same workflows and scene conditions after the repair. Correct any unintended desktop difference before release.

Internal, backend, performance, and security work may proceed when it preserves desktop presentation and interactions.
