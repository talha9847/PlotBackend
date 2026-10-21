CREATE TABLE users (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 full_name VARCHAR(160) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 phone VARCHAR(30),
 password_hash TEXT NOT NULL,
 role VARCHAR(30) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager','accountant','sales','viewer')),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 email_verified_at TIMESTAMPTZ,
 last_login_at TIMESTAMPTZ,
 password_changed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 deleted_at TIMESTAMPTZ
);


CREATE TABLE projects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    plots INTEGER DEFAULT 0 NOT NULL CHECK(plots>=0),
    project_type VARCHAR(40) NOT NULL DEFAULT 'residential' 
        CHECK(project_type IN ('residential','commercial','industrial','mixed_use','agricultural','other')),
    status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK(status IN ('planning','active','on_hold','completed','archived')),
    address_line1 TEXT, address_line2 TEXT,
    city VARCHAR(100), 
    district VARCHAR(100), 
    state VARCHAR(100),
    postal_code VARCHAR(20), 
    total_area NUMERIC(16,3) CHECK(total_area IS NULL OR total_area >= 0),
    area_unit VARCHAR(20) NOT NULL DEFAULT 'sq_ft' CHECK(area_unit IN ('sq_ft','sq_m','sq_yd','acre','hectare','guntha','bigha','other')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);




CREATE TABLE plots (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 plot_number VARCHAR(80) NOT NULL,
 plot_type VARCHAR(30) NOT NULL DEFAULT 'residential' CHECK(plot_type IN ('residential','commercial','industrial','agricultural','other')),
 base_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(base_price >= 0),
 status VARCHAR(24) NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','booked','sold','blocked','under_development')),
 notes TEXT, 
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), 
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), 
 deleted_at TIMESTAMPTZ,
 UNIQUE(project_id,plot_number)
);



CREATE TABLE brokers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(30)  UNIQUE NOT NULL,
    alternate_phone VARCHAR(30),
    email VARCHAR(254) UNIQUE NOT NULL,
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country_code CHAR(2) NOT NULL DEFAULT 'IN',
    notes TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_brokers_phone
    ON brokers (phone);
CREATE INDEX idx_brokers_email
    ON brokers (email);
CREATE INDEX idx_brokers_city
    ON brokers (city);
CREATE INDEX idx_brokers_deleted_at
    ON brokers (deleted_at);






CREATE TABLE leads (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    alternate_phone VARCHAR(30),
    email VARCHAR(254),
    customer_type VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (
            customer_type IN (
                'individual',
                'company',
                'partnership',
                'trust',
                'other'
            )
        ),
    is_converted BOOLEAN NOT NULL DEFAULT FALSE,
    project_id BIGINT
        REFERENCES projects(id) ON DELETE RESTRICT,
    plot_id BIGINT
        REFERENCES plots(id) ON DELETE RESTRICT,
    broker_id BIGINT
        REFERENCES brokers(id) ON DELETE SET NULL,
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country_code CHAR(2) NOT NULL DEFAULT 'IN',
    notes TEXT,
    created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
-- Indexes
CREATE INDEX idx_leads_project_id
    ON leads(project_id);
CREATE INDEX idx_leads_plot_id
    ON leads(plot_id);
CREATE INDEX idx_leads_broker_id
    ON leads(broker_id);
CREATE INDEX idx_leads_deleted_at
    ON leads(deleted_at);







CREATE TABLE bookings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    booking_number VARCHAR(80) NOT NULL UNIQUE,
    project_id BIGINT NOT NULL
        REFERENCES projects(id) ON DELETE RESTRICT,
    plot_id BIGINT NOT NULL
        REFERENCES plots(id) ON DELETE RESTRICT,
    lead_id BIGINT NOT NULL
        REFERENCES leads(id) ON DELETE RESTRICT,
    customer_id BIGINT
        REFERENCES customers(id) ON DELETE RESTRICT,
    booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
    agreed_price NUMERIC(14,2) NOT NULL
        CHECK (agreed_price >= 0),
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (tax_amount >= 0),
    total_amount NUMERIC(14,2) NOT NULL
        CHECK (total_amount >= 0),
    booking_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (booking_amount >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending', 'reserved', 'confirmed',
                'cancelled', 'completed', 'refunded'
            )
        ),
    cancellation_reason TEXT,
    notes TEXT,
    created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (discount_amount <= agreed_price),
    CHECK (booking_amount <= total_amount)
);
CREATE INDEX idx_bookings_customer_id
    ON bookings(customer_id);




CREATE TABLE customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    lead_id BIGINT NOT NULL UNIQUE
        REFERENCES leads(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);





CREATE TABLE customer_plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    customer_id BIGINT NOT NULL
        REFERENCES customers(id) ON DELETE RESTRICT,
    booking_id BIGINT NOT NULL UNIQUE
        REFERENCES bookings(id) ON DELETE RESTRICT,
    down_payment NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (down_payment >= 0),
    installment_count INTEGER NOT NULL
        CHECK (installment_count > 0),
    frequency VARCHAR(24) NOT NULL DEFAULT 'monthly'
        CHECK (
            frequency IN (
                'weekly',
                'monthly',
                'quarterly',
                'half_yearly',
                'yearly',
                'milestone',
                'custom'
            )
        ),
    start_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled')),
    notes TEXT,
    remaining_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        CHECK (remaining_balance >= 0),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customer_plans_customer_id
    ON customer_plans(customer_id);









CREATE TABLE installments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    customer_plan_id BIGINT NOT NULL
        REFERENCES customer_plans(id) ON DELETE RESTRICT,
    installment_number INTEGER NOT NULL
        CHECK (installment_number > 0),
    description VARCHAR(200),
    due_date DATE NOT NULL,
    amount_due NUMERIC(14,2) NOT NULL
        CHECK (amount_due >= 0),
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (amount_paid >= 0),
    late_fee NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (late_fee >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'partially_paid',
                'paid',
                'overdue',
                'waived',
                'cancelled'
            )
        ),
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_plan_id, installment_number),
    CHECK (amount_paid <= amount_due + late_fee)
);
CREATE INDEX idx_installments_customer_plan_id
    ON installments(customer_plan_id);
CREATE INDEX idx_installments_due_date_status
    ON installments(due_date, status);

CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

    payment_number VARCHAR(80) NOT NULL UNIQUE,

    booking_id BIGINT NOT NULL
        REFERENCES bookings(id) ON DELETE RESTRICT,

    customer_id BIGINT NOT NULL
        REFERENCES customers(id) ON DELETE RESTRICT,

    installment_id BIGINT
        REFERENCES installments(id) ON DELETE RESTRICT,

    account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,

    payment_method VARCHAR(24) NOT NULL
        CHECK (
            payment_method IN (
                'cash',
                'upi',
                'bank_transfer',
                'card',
                'cheque',
                'other'
            )
        ),

    amount NUMERIC(14,2) NOT NULL
        CHECK (amount > 0),

    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    received_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,

    status VARCHAR(24) NOT NULL DEFAULT 'completed'
        CHECK (
            status IN (
                'pending',
                'completed',
                'failed',
                'cancelled',
                'partially_refunded',
                'refunded'
            )
        ),

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for account lookups
CREATE INDEX IF NOT EXISTS idx_payments_account_id
    ON payments (account_id);
-- Indexes
CREATE INDEX idx_payments_booking_id
    ON payments(booking_id);
CREATE INDEX idx_payments_customer_id
    ON payments(customer_id);
CREATE INDEX idx_payments_installment_id
    ON payments(installment_id);
CREATE INDEX idx_payments_payment_date
    ON payments(payment_date);
CREATE INDEX idx_payments_status
    ON payments(status);



CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    account_name VARCHAR(100) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE parties (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    party_type VARCHAR(30) NOT NULL DEFAULT 'other'
        CHECK (
            party_type IN (
                'driver',
                'employee',
                'vendor',
                'supplier',
                'landlord',
                'customer',
                'broker',
                'other'
            )
        ),
    phone VARCHAR(30) UNIQUE,
    email VARCHAR(254),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_parties_name
    ON parties(name);
CREATE INDEX idx_parties_deleted_at
    ON parties(deleted_at);








CREATE TABLE transaction_categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_transaction_categories_deleted_at
    ON transaction_categories(deleted_at);





CREATE TABLE financial_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    transaction_number VARCHAR(80) NOT NULL UNIQUE,
    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('income', 'expense')),
    account_id BIGINT NOT NULL
        REFERENCES accounts(id) ON DELETE RESTRICT,
    party_id BIGINT
        REFERENCES parties(id) ON DELETE RESTRICT,
    category_id BIGINT NOT NULL
        REFERENCES transaction_categories(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL
        CHECK (amount > 0),
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method VARCHAR(24) NOT NULL DEFAULT 'cash'
        CHECK (
            payment_method IN (
                'cash',
                'upi',
                'bank_transfer',
                'card',
                'cheque',
                'other'
            )
        ),
    status VARCHAR(20) NOT NULL DEFAULT 'posted'
        CHECK (status IN ('pending', 'posted', 'cancelled')),
    reference_number VARCHAR(100),
    notes TEXT,
    created_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_financial_transactions_account_date
    ON financial_transactions(account_id, transaction_date DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_financial_transactions_party
    ON financial_transactions(party_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_financial_transactions_category
    ON financial_transactions(category_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_financial_transactions_type_status
    ON financial_transactions(transaction_type, status)
    WHERE deleted_at IS NULL;











CREATE TABLE installment_reschedules (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 installment_id BIGINT NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
 old_due_date DATE NOT NULL, new_due_date DATE NOT NULL, 
 reason TEXT NOT NULL,
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, 
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);