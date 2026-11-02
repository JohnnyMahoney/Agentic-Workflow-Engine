# E2E round 2

1. [Modern UI M-1005](test-1-modern-M1005/README.md): SUCCESS; explicitly accepted by the administrator.
2. [Legacy UI M-1006](test-2-legacy-M1006/README.md): SUCCESS; administrator acceptance pending. Claude chose the direct content page during discovery.
3. [Awkward UI M-1007](test-3-awkward-M1007/README.md): FAILED business verification; engine incorrectly reported SUCCESS with a balance placeholder. Subsequent saved-evidence recompilation and readiness replay succeeded; original failure preserved, administrator acceptance pending.
4. [Modern UI M-1008 Youth](test-4-modern-M1008-youth/README.md): SUCCESS after the additive selectedOptionLabel extension and saved-evidence recompilation. First two rejected candidates preserved. Replay and terminal sandbox state verify exactly M-1008-S1 (Youth); administrator acceptance pending.
5. [Legacy UI M-1009 Youth](test-5-legacy-M1009-youth/README.md): ACCEPTED by the administrator for correctly detecting a manually reproduced Legacy UI defect. Actual UI observation recorded VALIDATION_ERROR. Account creation, Compilation and Replay did not complete.
6. [Awkward UI M-1010 Youth](test-6-awkward-M1010-youth/README.md): SUCCESS after safe recovered-failure admission and saved-evidence Compilation. Failed action 7 preserved in audit and excluded from artifact. Replay and actual sandbox state verify exactly M-1010-S1 (Youth); administrator acceptance pending.

The intended pipeline is new Claude Discovery, separate Claude Compilation,
Evidence Validation and fresh-session Playwright Replay without LLM calls. Some
cases stopped early or required saved-evidence recompilation, as noted above.
