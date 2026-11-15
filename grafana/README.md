# Grafana for HazelPOS (for you, the vendor)

One screen for all your restaurants, with history and alerts:

- online or offline
- orders and sales today
- errors
- "orders made while locked" (cheating)
- app versions
- who hasn't paid
- AI cost

Grafana sends you an alert when something needs you.

```
Restaurant PCs ──every minute──► HazelPOS Cloud ── /metrics (secret token)
                                                      ▲
                       Grafana Cloud (free) ──────────┘ reads it every minute, keeps the history,
                                                        draws the dashboard, sends alerts
```

`/metrics` holds numbers plus client and branch names. It has no customer names, phone numbers, addresses or emails.

## 1. Turn it on in the cloud (Railway)

Add one variable to the cloud service:

| Variable | Value |
|---|---|
| `METRICS_TOKEN` | a long random secret, 24+ characters (e.g. `openssl rand -hex 24`) |
| `METRICS_TZ` | optional, default `Asia/Karachi`: the restaurants' "today" |
| `METRICS_ONLINE_MINUTES` | optional, default `10`: no sync for this long = offline |

Without `METRICS_TOKEN`, `/metrics` doesn't exist (404).

Check it:

```
curl -H "Authorization: Bearer <token>" https://<your-cloud>/metrics
```

## 2. Grafana Cloud (free)

1. Make a free account at grafana.com, and create a stack (pick a region near Pakistan, e.g. Singapore or Mumbai).
2. **Connections → Add new connection → Metrics Endpoint**. Fill it in:
   - Scrape job URL: `https://<your-cloud>/metrics`
   - Authentication: **Bearer**, using the token from step 1
   - Scrape interval: **1 minute**
   - Press "Test connection", then "Save".
3. **Dashboards → New → Import**. Upload [`hazelpos-dashboard.json`](hazelpos-dashboard.json), and pick your Grafana Cloud Prometheus as the data source.

## 3. Alerts

**Alerting → Contact points**: add where alerts go, such as email, Telegram or Slack. (Grafana has no WhatsApp; Telegram on your phone is the closest.)

**Alerting → Alert rules → New**: one rule per row below. Paste the query; "for" is how long the condition must last before you're told.

| Alert | Query | For | Why |
|---|---|---|---|
| POS offline | `hazel_branch_online == 0 and on(branch_id) hazel_branch_activated == 1` | 2h | PC off, no internet, or app closed. Normal at night if they close; mute 2am–11am with a mute timing. |
| Possible cheating | `hazel_branch_locked_orders > 0` | 0m | Orders arrived while the POS should have been locked. |
| Many errors | `hazel_branch_errors_24h > 20` | 15m | Printer, WhatsApp or app problems; open Health & errors in the admin app. |
| Orders not syncing | `hazel_branch_sync_pending_orders > 20` | 30m | Online, but orders aren't reaching the cloud. |
| WhatsApp disconnected | `hazel_branch_whatsapp_connected == 0 and on(branch_id) hazel_branch_online == 1` | 1h | The bot can't take orders; the phone needs relinking. Based on the POS health report (every few hours). |
| Client unpaid | `hazel_client_days_overdue > 0` | 0m | Time to call them (see Unpaid in the admin app). |
| AI cost high | `hazel_ai_cost_month_usd > 20` | 0m | Change 20 to your budget. |

## All numbers

| Metric | Meaning |
|---|---|
| `hazel_clients_total`, `hazel_branches_total` | counts |
| `hazel_client_days_overdue`, `hazel_client_paid`, `hazel_client_bot_active`, `hazel_client_pos_active`, `hazel_client_stopped`, `hazel_client_monthly_fee_rs` | membership per client |
| `hazel_branch_activated`, `hazel_branch_online`, `hazel_branch_last_sync_age_seconds` | is the POS installed and talking to the cloud |
| `hazel_branch_orders_today`, `hazel_branch_sales_today_rs`, `hazel_branch_refunds_today`, `hazel_branch_cancelled_today` | today, restaurant time |
| `hazel_branch_errors_24h`, `hazel_branch_locked_orders`, `hazel_branch_sync_pending_orders`, `hazel_branch_whatsapp_connected`, `hazel_branch_health_age_seconds` | problems |
| `hazel_branch_version_info{version}` | app version (value always 1) |
| `hazel_branch_ai_calls_today`, `hazel_branch_ai_failed_today`, `hazel_branch_ai_cost_today_usd`, `hazel_branch_ai_cost_month_usd`, `hazel_ai_cost_month_usd` | AI use and estimated cost |
