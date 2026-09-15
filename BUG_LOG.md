# BUG_LOG.md — Master Bug Tracking & Resolution Register

All bugs identified, diagnosed, and resolved in this repository are recorded here in accordance with the Software Factory protocol.

| Bug ID | Date | Module / File | Description / Root Cause | Fix Applied | Status | Verification Proof |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | 2026-09-15 | lib/reports/brief-anomalies.ts<br>lib/reports/brief-travaux.ts | Linter crash due to unconfigured rule directive // eslint-disable-next-line @typescript-eslint/no-explicit-any. | Removed stale disable directives. | **FIXED** | 
ext lint exit code 0 |
| **BUG-002** | 2026-09-15 | components/propria/checkup-inventory-grid.tsx | Stale ref access in useEffect cleanup (measureTimers.current) risking unmount memory leak / null dereference. | Captured measureTimers.current into local variable 	imers inside the effect closure. | **FIXED** | 
eact-hooks/exhaustive-deps clean |
| **BUG-003** | 2026-09-15 | components/propria/checkup-checklist-grid.tsx | itemsByKey Map instantiated anew on every render, invalidating downstream useCallback and useMemo hooks, plus unmount timer ref hazard. | Memoized itemsByKey with useMemo(..., [items]) and captured timers in local closure. | **FIXED** | 
eact-hooks/exhaustive-deps clean |
| **BUG-004** | 2026-09-15 | components/achats/achats-bulk-panel.tsx | 
extFreeAcompte missing from useMemo dependency array + useCallback missing from React imports (TS2304). | Added useCallback to React imports and memoized 
extFreeAcompte with dependency on 	akenByLot. | **FIXED** | 	sc --noEmit exit code 0 |
| **BUG-005** | 2026-09-15 | .eslintrc.json | Linter false-positives blocking valid Server Actions (*-actions.ts), Route Handlers (pp/**/route.ts), and Server Components due to narrow glob patterns. | Expanded .eslintrc.json overrides to cover all server actions, routes, and server components, and disabled legacy XHTML entity rule for JSX text. | **FIXED** | 
pm run lint exit code 0 |
