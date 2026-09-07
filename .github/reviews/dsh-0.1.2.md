# DSH 0.1.2-rc.1 compatibility

Reviewed on 2026-09-07; npm latest and next both resolve to 0.1.2-rc.1.

Wait for the client services before registering the renderer. Resolve memoized native Markdown through the module loader, forward its current labels/streaming props, and delegate assistant attachments to the host image gallery.

## Validation

Client loading and React/jsdom rendering regressions pass, including streaming transitions, localized labels and attachment ordering. The actual npm archive builds and validates.

The real DSH checks used a new disposable home, locally generated attachments and an offline model, with all four plugins installed together. No existing user conversations or remote model credentials were used. The isolated server was stopped after checks.

Browser interaction acceptance remains pending: the local Chrome test page returned ERR_BLOCKED_BY_CLIENT. Component tests do not substitute for visual acceptance. npm publication is pending final acceptance and registry authentication.
