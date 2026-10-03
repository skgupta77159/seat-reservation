# Seat Reservation API

This service exposes endpoints for creating shows, reserving seats, and cancelling reservations.

## Base URL

- Local: http://localhost:3000

## Authentication

Most endpoints require a Bearer token in the Authorization header.

- Admin token for creating shows: `Bearer <ADMIN_TOKEN>`
- User token for reservations/cancellations: `Bearer user-123` or any user id token you choose

---

## 1. Create a show

### POST /shows

Creates a show and initializes all seat rows.

Headers:
- Authorization: Bearer <admin-token>
- Content-Type: application/json

Request body:
```json
{
  "name": "Test Show",
  "seats": ["A1", "A2", "A3"],
  "price_paise": 1500
}
```

Success response: 201
```json
{
  "id": "<uuid>",
  "name": "Test Show",
  "seats": ["A1", "A2", "A3"],
  "price_paise": 1500,
  "per_user_limit": 4
}
```

Validation errors:
- `invalid_name`
- `invalid_seats`
- `duplicate_seats`
- `invalid_price`
- `unauthorized`
- `forbidden`

---

## 2. Get show details

### GET /shows/:showId

Returns show metadata, seat status counts, and the current seat list.

Success response: 200
```json
{
  "id": "<uuid>",
  "name": "Test Show",
  "price_paise": 1500,
  "per_user_limit": 4,
  "counts": {
    "total": 3,
    "available": 2,
    "held": 0,
    "confirmed": 1
  },
  "reconciliation": {
    "valid": true,
    "expected": 3,
    "actual": 3
  },
  "seats": [
    { "seat_number": "A1", "status": "confirmed" },
    { "seat_number": "A2", "status": "available" },
    { "seat_number": "A3", "status": "available" }
  ]
}
```

Not found response: 404
```json
{
  "error": "show_not_found"
}
```

---

## 3. Reserve seats

### POST /shows/:showId/reserve

Legacy route for reservations.

Headers:
- Authorization: Bearer <user-token>
- Content-Type: application/json

Request body:
```json
{
  "seats": ["A1", "A2"],
  "idempotency_key": "booking-001"
}
```

### POST /reservations

Compatible modern route.

Headers:
- Authorization: Bearer <user-token>
- Idempotency-Key: booking-001
- Content-Type: application/json

Request body:
```json
{
  "show_id": "<uuid>",
  "seats": ["A1", "A2"]
}
```

Success response: 201
```json
{
  "reservation_id": "<uuid>",
  "show_id": "<uuid>",
  "user_id": "user-123",
  "seats": ["A1", "A2"],
  "amount_paise": 3000,
  "status": "confirmed"
}
```

Common error responses:
- 400: `seats_required`, `invalid_seats`, `duplicate_seats`, `idempotency_key_required`, `show_id_required`, `invalid_show_id`
- 404: `show_not_found`
- 409: `per_user_limit`, `seat_taken`, `idempotency_conflict`

---

## 4. Cancel a reservation

### POST /reservations/:reservationId/cancel

Headers:
- Authorization: Bearer <user-token>
- Content-Type: application/json

Success response: 200
```json
{
  "reservation_id": "<uuid>",
  "status": "cancelled"
}
```

Error responses:
- 403: `forbidden`
- 404: `reservation_not_found`

---

## 5. Health check

### GET /health

Returns service health.

Success response: 200
```json
{
  "status": "ok"
}
```

---

## 6. Metrics

### GET /metrics

Returns Prometheus metrics.

---

## Notes

- Seats are tracked by seat number and status.
- Reservation requests are idempotent per user + show + idempotency key.
- The same idempotency key with a different requested seat payload returns `idempotency_conflict`.
