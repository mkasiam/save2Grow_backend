# Save2Grow Backend API

Node.js Express server with MongoDB for the Save2Grow fintech application.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

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

