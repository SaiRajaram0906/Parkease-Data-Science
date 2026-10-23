# ParkEase with the Data Science layer: how to run

Everything runs from the project root (the folder that contains `frontend`,
`backend`, `ml` and `data`). On Windows, use the PowerShell terminal and run
one line at a time.

## One-time setup

You need Node 20.6 or newer, pnpm, Python 3.10 or newer, and PostgreSQL.

Install the Node packages:

```
pnpm install
```

Point the app at your database. In both `backend/.env` and `lib/db/.env`, set
the line below to your own PostgreSQL password (the database called `postgres`
exists on every installation, so nothing needs to be created):

```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"
```

Create the tables:

```
$env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"
```
```
pnpm --filter @workspace/db run push
```

Install the Python packages:

```
python -m pip install -r ml/requirements.txt
```

Train the models. This validates the data, cleans it, builds the features,
trains and evaluates the three models, and writes them to `models/`. It takes
about two minutes.

```
python -m ml.training.train_all
```

## Every time: three terminals

Terminal 1, the Data Science service:

```
python -m uvicorn ml.service.app:app --port 8000
```

Terminal 2, the ParkEase API server. Run the two lines one after the other
(the project's `dev` script joins them with `&&`, which Windows PowerShell 5
does not accept):

```
pnpm --filter @workspace/api-server run build
```
```
pnpm --filter @workspace/api-server run start
```

Terminal 3, the ParkEase web app (as before):

```
pnpm --filter @workspace/parkease run dev
```

Open http://localhost:5173.

The API server adds three optional columns to the database when it starts
(`users.dataset_user_id`, `users.password_hash` and `spots.dataset_slot_id`).
Nothing else in the database is changed.

## Signing in

- **Demo accounts:** the Driver, Owner and Admin buttons on the login page.
- **Your own account:** choose Register, then Driver or Owner. The password
  needs 8 or more characters with a number and a symbol.
- **An account made before passwords existed:** sign in with its email and a
  new password; that first sign-in sets the password.
- Admin cannot be chosen at sign-up. Use the demo Admin, who can change any
  user's role in the Admin console.

## Load the demo data (once)

1. On the login page choose the demo **Owner** account.
2. Open **Analytics** in the top menu and press **Load demo data**.

This adds 66 demo parking spots and the demo accounts, linked to the
historical dataset. It only adds rows; it never changes or deletes existing
ParkEase data. Pressing it again does nothing.

## Where to look

| Feature | Log in as | Where |
|---|---|---|
| Smart parking recommendation | Driver | Find Parking |
| Availability prediction | Driver | Any spot page, "Availability forecast" |
| Driver analytics | Driver | Dashboard |
| Slot performance analytics | Owner | Dashboard, "My listings" |
| Demand forecast and price recommendation | Owner | Dashboard, "My listings", "Demand & pricing" |
| EDA and model performance | Owner or Admin | Analytics |
| Platform overview (all revenue, users, bookings) | Admin | Dashboard |
| Change user roles, manage any listing | Admin | Admin |

## Other commands

| Command | What it does |
|---|---|
| `python -m ml.preprocessing.validate_data` | Runs the 42 data validation checks |
| `python -m ml.eda.make_figures` | Writes the nine EDA figures to `data/reports/figures` |
| `python -m pytest ml/tests -q` | Runs the 35 automated tests |
| http://localhost:8000/docs | Interactive documentation of the Data Science service |

## If something is missing

- **"Data Science insights are unavailable right now"** in the app: the
  service in terminal 1 is not running. The rest of ParkEase keeps working.
- **"Trained models not found"**: run `python -m ml.training.train_all`.
- **Models fail to load after changing Python or scikit-learn**: run the
  training command again; saved models only load with the version that
  trained them.
- **"Please sign in to continue"** on a page that was open before an update:
  sign out and sign in again.
- The service address can be changed with the `ML_SERVICE_URL` environment
  variable of the API server (default `http://127.0.0.1:8000`).
