Replace/add these files at repository root.
Delete pnpm-lock.yaml from the repository.
Keep your CSVs, Firebase config, UI files, and model .joblib files unchanged.
After commit, redeploy cpas-api first. When live, set cpas-web VITE_API_BASE_URL to the new API URL and rebuild/deploy.
