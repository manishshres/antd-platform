# Bugfix Requirements Document

## Introduction

Two responsive layout bugs affect the Call Center app on mobile and tablet viewports (< 992px / below Ant Design's `lg` breakpoint):

1. **Call Details page** (`/src/app/calls/[id]/page.tsx`): The Recording card and the Transcript card appear side by side instead of stacking vertically. The correct stacking order on mobile/tablet should be: Recording → AI Summary → Call Outcome → Transcript.

2. **DashboardLayout sidebar** (`/src/components/DashboardLayout.tsx`): The `Layout.Sider` is always visible regardless of viewport size. On mobile/tablet it should be replaced with a hamburger menu button in the header that opens an Ant Design `Drawer`. The component has no responsive detection and no Drawer implementation at all.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the viewport width is below 992px (below Ant Design `lg` breakpoint) AND the user views the Call Details page THEN the system renders the Recording/AI Summary/Call Outcome column and the Transcript column side by side instead of stacking them vertically.

1.2 WHEN the viewport width is below 992px AND the user views the Call Details page THEN the system does not render the sections in the correct mobile order (Recording → AI Summary → Call Outcome → Transcript).

1.3 WHEN the viewport width is below 992px (below Ant Design `lg` breakpoint) AND the user views any page with `DashboardLayout` THEN the system renders the full-width `Layout.Sider` sidebar, consuming screen space and causing layout overflow instead of hiding it.

1.4 WHEN the viewport width is below 992px AND the user is on any `DashboardLayout` page THEN the system does not render a hamburger menu button in the header, leaving no way to open navigation on mobile.

1.5 WHEN the viewport width is below 992px AND the user has opened the mobile navigation Drawer THEN the system does not have a Drawer at all, so there is no way to access navigation menu items.

---

### Expected Behavior (Correct)

2.1 WHEN the viewport width is below 992px AND the user views the Call Details page THEN the system SHALL render each content section (Recording, AI Summary, Call Outcome, Transcript) as a full-width block stacked vertically, occupying 24 of 24 grid columns (`xs={24}`).

2.2 WHEN the viewport width is below 992px AND the user views the Call Details page THEN the system SHALL display sections in the order: Recording → AI Summary → Call Outcome → Transcript, matching the natural document flow.

2.3 WHEN the viewport width is 992px or above (lg and above) AND the user views the Call Details page THEN the system SHALL render the left column (Recording, AI Summary, Call Outcome) at 8 of 24 columns (`lg={8}`) and the Transcript column at 16 of 24 columns (`lg={16}`) side by side.

2.4 WHEN the viewport width is below 992px AND the user views any `DashboardLayout` page THEN the system SHALL hide the `Layout.Sider` and SHALL render a hamburger menu (`MenuOutlined`) button in the header.

2.5 WHEN the viewport width is 992px or above AND the user views any `DashboardLayout` page THEN the system SHALL render the `Layout.Sider` permanently visible at 240px width without a collapse trigger.

2.6 WHEN the user taps the hamburger button on mobile THEN the system SHALL open an Ant Design `Drawer` containing the navigation `Menu`.

2.7 WHEN the user taps a navigation menu item inside the Drawer THEN the system SHALL navigate to the selected route AND SHALL automatically close the Drawer.

2.8 WHEN detecting the current breakpoint in `DashboardLayout` THEN the system SHALL use `Grid.useBreakpoint()` from Ant Design for responsive detection.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the viewport width is 992px or above AND the user views the Call Details page THEN the system SHALL CONTINUE TO render the two-column layout with left column at `lg={8}` and Transcript at `lg={16}`.

3.2 WHEN the viewport width is 992px or above AND the user views any `DashboardLayout` page THEN the system SHALL CONTINUE TO display the sidebar at 240px with the full navigation menu visible without requiring any hamburger interaction.

3.3 WHEN the user clicks any navigation item in the sidebar on desktop THEN the system SHALL CONTINUE TO navigate to the correct route.

3.4 WHEN the user views the Call Details page at any viewport THEN the system SHALL CONTINUE TO display the hero header, metadata strip, Recording audio player, AI Summary, Call Outcome, and Transcript sections with their current content and functionality intact.

3.5 WHEN the user views the metadata strip on the Call Details page THEN the system SHALL CONTINUE TO render it with the existing `xs={12} sm={8} md={4}` responsive column layout unchanged.
