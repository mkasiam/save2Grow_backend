# Save2Grow Backend API

Node.js Express server with MongoDB for the Save2Grow fintech application.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Required payment environment variables:
- `SSL_STORE_ID`
- `SSL_STORE_PASSWORD`
- `SSL_SESSION_API`
- `SSL_VALIDATION_API`
- `SSL_CALLBACK_BASE_URL`

Use your sandbox store credentials in `.env` and set `SSL_CALLBACK_BASE_URL` to the public backend URL that SSLCommerz can reach.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new student
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users/:id` - Get user profile
- `PUT /api/users/:id` - Update user profile
- `GET /api/users/:id/stats` - Get user statistics

### Goals
- `POST /api/goals` - Create new savings goal
- `GET /api/goals` - Get all user goals
- `GET /api/goals/:id` - Get single goal
- `PUT /api/goals/:id` - Update goal
- `DELETE /api/goals/:id` - Delete goal
- `POST /api/goals/:id/add-savings` - Add money to goal

### Transactions
- `POST /api/transactions` - Create transaction
- `GET /api/transactions` - Get user transactions
- `GET /api/transactions/goal/:goalId` - Get goal transactions

### Challenges
- `POST /api/challenges` - Create challenge
- `GET /api/challenges` - Get all challenges
- `POST /api/challenges/:id/join` - Join challenge
- `GET /api/challenges/user/challenges` - Get user challenges
- `GET /api/challenges/admin?status=all|active|inactive&page=1&limit=20` - Admin challenge list with filtering and pagination
- `PUT /api/challenges/admin/:id` - Update challenge
- `DELETE /api/challenges/admin/:id` - Delete challenge

### Withdrawals
- `POST /api/withdrawals/request` - Create a challenge withdrawal request
- `GET /api/withdrawals/me` - Get the signed-in user's withdrawal requests
- `GET /api/withdrawals/admin` - Admin review list
- `PUT /api/withdrawals/:id/status` - Approve or reject a withdrawal request

### Notifications
- `GET /api/notifications` - Fetch in-app notifications for the signed-in user
- `PUT /api/notifications/:id/read` - Mark a notification as read

### SSLCommerz Sandbox and Manual Payout Notes
SSLCommerz is treated here as a deposit/collection gateway only. The project does not implement automated payout/disbursement because the standard SSLCommerz API does not provide direct mass payouts in sandbox.

Manual simulation steps for deposits in the sandbox:
1. Use the SSLCommerz sandbox credentials in your backend environment.
2. Start a deposit from the mobile app and complete the sandbox checkout flow.
3. Confirm the payment status in your backend transaction log.
4. Keep the transaction record as the source of truth for the user's deposit balance.

Manual steps for withdrawal handling:
1. The user submits a withdrawal request from the challenge detail screen.
2. The request is stored as `pending` with the calculated payout and penalty details.
3. The admin reviews it in the Payments screen under `Withdrawal Requests`.
4. On approval, the app stores an `approved & processing` notification and a processing transaction record.
5. The admin completes the actual bank transfer outside SSLCommerz and marks the request as handled in the app.
6. If needed, note the bank transfer reference number in the admin note field for audit purposes.

