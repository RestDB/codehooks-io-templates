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
```

### Setup backend with template

**Option 1: Create new project with template (Recommended)**
```bash
coho create my-backend --template react-bff
cd my-backend
npm install
```

**Option 2: Install in existing directory**
```bash
mkdir my-backend
cd my-backend
coho install react-bff
npm install
```

