# Tidewater

The orders and stock API behind Tidewater Coffee Roasters' web shop and packing
screen. It has no dependencies: Node 20 or later is all it needs.

```sh
npm run dev    # http://localhost:3000
npm test
```

## Endpoints

| Method | Path               | What it does                          |
| ------ | ------------------ | ------------------------------------- |
| GET    | `/api/orders`      | Lists orders. Filter with `?status=`. |
| GET    | `/api/orders/:id`  | One order, with its totals.           |
| POST   | `/api/orders`      | Places an order.                      |
| GET    | `/api/inventory`   | Green and roasted stock, by SKU.      |

Order statuses: `placed`, `roasting`, `packed`, `shipped`, `delivered`.
Money is always in integer cents.
