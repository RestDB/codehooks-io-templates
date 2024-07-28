# Backend for Frontend (BFF)

A complete example with a React frontend app and a Codehooks backend-for-frontend.

The React app is deployed and hosted together with the backend for lowest possible network and database latency.

## React frontend

### Install base frameworks
```bash
npm create vite@latest my-react-app --template react
cd my-react-app
npm install react-router-dom
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm run dev
```

## Codehooks.io backend

### Install backend dependencies

```bash
npm i -g codehooks
coho login
cd my-backend
```

### Connect to a Codehooks project

```bash
coho init --empty
npm install
```

