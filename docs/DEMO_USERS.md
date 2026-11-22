# Demo users & credentials

Synthetic Harborline Logistics accounts for the hackathon. There is no signup;
every account is seeded from `datasets/brim_ap_dataset/data/users.csv`.

## Credentials

- **Username:** the dataset `user_id` (for example `U007`)
- **Password (all users):** `demo1234`

Login:

```http
POST /api/auth/login/
Content-Type: application/json

{ "username": "U007", "password": "demo1234" }
```

Response:

```json
{
  "token": "<opaque DRF token>",
  "user": {
    "id": "U007",
    "username": "U007",
    "full_name": "Dev Malhotra",
    "role": "APPROVER",
    "status": "active"
  }
}
```

Send the token on every other request:

```http
Authorization: Bearer <token>
```

## One active account per role

| Role | Username | Name | Approval limit (CAD) |
|---|---|---|---:|
| Employee | `U013` | Aiden Grant | 0 |
| AP Clerk | `U004` | Jordan Okafor | 0 |
| Approver | `U007` | Dev Malhotra | 10,000 |
| Finance Manager | `U003` | Elise Tremblay | 50,000 |
| Controller / Admin | `U001` | Priya Raman | 500,000 |
| Auditor | `U006` | Hannah Lindqvist | 0 |

Other active users exist in the seed. The table above is enough to demonstrate
every role; usernames are case-sensitive.

## Implementation note

The demo password is set by `load_dataset` with `user.set_password(...)` on every
run, so re-seeding also repairs existing accounts. The password comes from the
`DEMO_PASSWORD` environment variable (default `demo1234`; see
`backend/.env.example`). Authentication is DRF token auth sent as
`Authorization: Bearer <token>`. These are fake credentials for synthetic data —
never reuse them outside the demo.
