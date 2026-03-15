# Point System Test Cases

Verified with local Firebase emulators on March 16, 2026.

| ID | Scenario | Result | Notes |
| --- | --- | --- | --- |
| R-1 | Student can read own wallet | Pass | Allowed after wallet exists |
| R-2 | Student direct wallet write | Pass | Blocked by rules |
| R-3 | Teacher direct order write | Pass | Blocked by rules |
| A-1 | Attendance first reward | Pass | `amount=5`, `balance=6` |
| A-2 | Attendance duplicate prevention | Pass | Duplicate returns without extra reward |
| B-1 | Quiz first reward | Pass | `amount=10`, `balance=16` |
| B-2 | Quiz duplicate prevention | Pass | Duplicate returns without extra reward |
| C-1 | Lesson first reward | Pass | `amount=3`, `balance=19` |
| C-2 | Lesson duplicate prevention | Pass | Duplicate returns without extra reward |
| D-1 | Purchase with insufficient balance | Pass | Callable rejected request |
| D-2 | Purchase with sold-out product | Pass | Callable rejected request |
| D-3 | Normal purchase request | Pass | Order created and hold transaction written |
| E-1 | Reader without `point_manage` tries manual adjust | Pass | Permission denied |
| E-2 | Teacher manual adjust without reason | Pass | Invalid argument rejected |
| E-3 | Teacher manual adjust success | Pass | Balance updated to `39` before purchases |
| F-1 | Direct fulfill from `requested` | Pass | Rejected by callable state validation |
| F-2 | Approve requested order | Pass | Status moved to `approved` |
| F-3 | Fulfill approved order | Pass | Status moved to `fulfilled` |
| F-4 | Reject requested order | Pass | Balance and stock restored |
| F-5 | Cancel requested order | Pass | Balance and stock restored |

## Final integrity snapshot

- Wallet balance: `29`
- Attendance transactions: `1`
- Quiz transactions: `1`
- Lesson transactions: `1`
- Manual adjust transactions: `2`
- Approved-flow order status: `fulfilled`
- Rejection-flow order status: `rejected`
- Cancel-flow order status: `cancelled`
- Gift product stock: `4`

## Notes

- The verification script uses a bootstrap manual adjustment to create the first wallet document before rules checks.
- Emulator logs still show permission-denied messages for the direct-write checks. Those are expected and counted as passing security tests.
