# OpenCred Bulk Revocation CLI

A command-line tool to bulk revoke OpenCred credentials from a CSV file. This demonstrates how to use OpenCred API keys for programmatic issuance and management.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
   Or optionally link it globally:
   ```bash
   npm link
   ```

2. **Generate an API Key**
   - Go to your OpenCred Dashboard > Settings > API keys.
   - Create a new API Key with the **Issuer** or **Admin** role.
   - Copy the secret key (it starts with `ock_...`).

## Usage

Prepare a CSV file containing the IDs of the credentials you wish to revoke. By default, the CLI looks for a column named `credentialId`.

**Example `to_revoke.csv`**:
```csv
name,email,credentialId
Alice,alice@example.com,k7m2q9xb4t
Bob,bob@example.com,p9x4n2bz1r
```

Run the CLI:

```bash
node cli.js --file to_revoke.csv --api-key ock_live_your_key_here
```

### Options

- `-f, --file <path>` (Required): Path to your CSV file.
- `-k, --api-key <key>` (Required): Your OpenCred API key.
- `-u, --url <url>`: The base URL of your OpenCred instance. Defaults to `http://localhost:4000`.
- `-c, --column <name>`: The name of the CSV column containing the credential ID. Defaults to `credentialId`.

Example using all options:
```bash
node cli.js -f list.csv -k ock_live_123 -u https://api.certs.example.com -c id
```
