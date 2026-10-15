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



CREATE TABLE customers (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), 
 name VARCHAR(100) NOT NULL, 
 phone VARCHAR(30) NOT NULL, 
 alternate_phone VARCHAR(30),
 email VARCHAR(254),
 customer_type VARCHAR(20) NOT NULL DEFAULT 'individual' CHECK(customer_type IN ('individual','company','partnership','trust','other')),
 address_line1 TEXT,
 address_line2 TEXT,
 city VARCHAR(100), district VARCHAR(100), state VARCHAR(100),
 postal_code VARCHAR(20), 
 country_code CHAR(2) NOT NULL DEFAULT 'IN',
 notes TEXT,
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 deleted_at TIMESTAMPTZ
);