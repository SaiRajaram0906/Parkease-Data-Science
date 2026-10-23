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

When it starts, the API server adds the database columns and the one table
the newer features need, and five large parking places (Saravana Stores,
Jeyachandran Textiles, Pondy Bazaar and Panagal Park in T. Nagar, and one
near Rajalakshmi Engineering College) owned by the demo Owner. It only adds;
nothing existing is changed or deleted.

## After replacing the files with a newer version

Stop the three terminals (Ctrl+C in each), then in the project folder:

```
pnpm install
```
```
pnpm --filter @workspace/api-server run build
```

and start the three terminals again as above. `pnpm install` is needed
because the update uses two new packages (one sends email, one draws QR
codes). The models do not need retraining.

## Sending real emails (optional)

Booking messages always appear in the app. To also send them by email, open
`backend/.env`, remove the `#` from the `SMTP_USER` and `SMTP_PASS` lines and
fill them in. With Gmail, `SMTP_PASS` must be a Google "app password", not
your normal password. Restart the API server, then use **Send a test email**
on the Profile page to check it. Demo accounts are never emailed.

## Signing in

- **Demo accounts:** the Driver, Owner and Admin buttons on the login page.
- **Your own account:** choose Register, then Driver or Owner. The password
  needs 8 or more characters with a number and a symbol, typed twice. The eye
  button shows what you typed.
- **Driver or Owner:** a driver account finds and books parking; an owner
  account lists parking. One account cannot do both.
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
| Parking assistant ("spot near Rajalakshmi engineering college") | Driver | Green chat button, bottom right |
| Availability prediction | Driver | Any spot page, "Availability forecast" |
| Driver analytics and rewards (free booking after 10) | Driver | Dashboard, My Bookings |
| Use a free booking | Driver | Book Now, tick "Use a free parking reward" |
| QR entry pass and numbered slot | Driver | Book a large place (for example Saravana Stores Parking), then open the booking |
| Start and end messages | Driver | Bell in the top bar, the booking page, and email |
| List a spot with city, state, latitude and longitude filled in | Owner | List Your Spot |
| Correct a listing's map pin | Owner | The spot page, "Edit location" |
| Check a QR entry pass | Owner | Verify Entry |
| Slot performance analytics | Owner | Dashboard |
| Demand forecast and price recommendation | Owner | Dashboard, "Demand & pricing" |
| EDA and model performance | Owner or Admin | Analytics |
| Platform overview (all revenue, users, bookings) | Admin | Dashboard |
| Change user roles, manage any listing | Admin | Admin |

To try the QR check: sign in as the demo Driver, book Saravana Stores
Parking for the current hour, open the booking and note the pass code. Sign
in as the demo Owner, open Verify Entry and type the code. (Scanning the QR
code with a phone only works once the app is on an address the phone can
reach, not `localhost`.)

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
