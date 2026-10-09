# Retention schedule

| Data | Retention | Basis |
|---|---|---|
| Account data | Until deletion by the user; after 2 years without any user action, notice by email, then deletion 30 days later | CNIL reference of 2 years of inactivity |
| Sessions | Until sign-out or expiry `[duration set in M7]` | Strictly necessary |
| Pending or rejected library submissions | Deleted with the account | Purpose ends |
| Published library texts | Kept while published, under CC BY-SA 4.0 with the chosen attribution; removed on takedown | License terms |
| Synced cards and review log | Until account deletion or user deletion of synced data | Purpose ends |
| League results | 12 weeks; deleted when leaving leagues | Purpose ends |
| Security logs | 6 months, purged automatically | CNIL délibération 2021-122 (6 months to 1 year) |
| Database backups | Rolling 30 days; deleted data disappears from backups within 30 days | Recovery only |
| Rights and support requests | `[TBD in M7]` | Proof of compliance |
| On-device data | Under the user's control; cleared by "Delete local data" or by clearing site data | Not held by the controller |

Purges run as scheduled jobs on the API host (M7). A failed purge job alerts the maintainer; it never silently skips.
