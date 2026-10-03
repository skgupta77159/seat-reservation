CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS shows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,

    price_paise BIGINT NOT NULL
        CHECK (price_paise >= 0),

    per_user_limit INTEGER NOT NULL DEFAULT 4
        CHECK (per_user_limit > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    show_id UUID NOT NULL
        REFERENCES shows(id)
        ON DELETE CASCADE,

    seat_number TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'held', 'confirmed')),

    UNIQUE(show_id, seat_number)
);


CREATE TABLE IF NOT EXISTS user_show_locks (
    show_id UUID NOT NULL
        REFERENCES shows(id)
        ON DELETE CASCADE,

    user_id TEXT NOT NULL,

    PRIMARY KEY(show_id, user_id)
);


CREATE TABLE IF NOT EXISTS reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    show_id UUID NOT NULL
        REFERENCES shows(id)
        ON DELETE CASCADE,

    user_id TEXT NOT NULL,

    amount_paise BIGINT NOT NULL,

    status TEXT NOT NULL
        CHECK (status IN ('confirmed', 'cancelled')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS reservation_seats (
    reservation_id UUID NOT NULL
        REFERENCES reservations(id)
        ON DELETE CASCADE,

    seat_id UUID NOT NULL
        REFERENCES seats(id),

    PRIMARY KEY(reservation_id, seat_id)
);


CREATE TABLE IF NOT EXISTS idempotency_keys (
    user_id TEXT NOT NULL,

    show_id UUID NOT NULL
        REFERENCES shows(id)
        ON DELETE CASCADE,

    idempotency_key TEXT NOT NULL,

    request_hash TEXT NOT NULL,

    result_status INTEGER,

    result_body JSONB,

    reservation_id UUID
        REFERENCES reservations(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY(user_id, show_id, idempotency_key)
);


CREATE INDEX IF NOT EXISTS idx_seats_show_status
    ON seats(show_id, status);

CREATE INDEX IF NOT EXISTS idx_reservations_user_show
    ON reservations(user_id, show_id);

CREATE INDEX IF NOT EXISTS idx_reservation_seats_seat
    ON reservation_seats(seat_id);