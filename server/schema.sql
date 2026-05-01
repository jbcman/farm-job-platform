-- ============================================================
-- 농민 일손 플랫폼 — PostgreSQL 스키마
-- 실행: node init_pg.js  (최초 1회 또는 Render 환경 배포 시)
-- ============================================================

CREATE TABLE IF NOT EXISTS jobs (
    id                    TEXT        PRIMARY KEY,
    requesterid           TEXT        NOT NULL,
    requestername         TEXT        NOT NULL DEFAULT '농민',
    category              TEXT        NOT NULL,
    locationtext          TEXT        NOT NULL,
    latitude              REAL,
    longitude             REAL,
    date                  TEXT        NOT NULL,
    timeslot              TEXT        DEFAULT '협의',
    areasize              INTEGER,
    areaunit              TEXT        DEFAULT '평',
    pay                   TEXT,
    note                  TEXT        DEFAULT '',
    imageurl              TEXT,
    isurgent              INTEGER     DEFAULT 0,
    status                TEXT        DEFAULT 'open',
    createdat             TEXT        NOT NULL,
    contactrevealed       INTEGER     DEFAULT 0,
    selectedworkerid      TEXT        DEFAULT NULL,
    selectedat            TEXT        DEFAULT NULL,
    closedat              TEXT        DEFAULT NULL,
    autoselected          INTEGER     DEFAULT 0,
    startedat             TEXT        DEFAULT NULL,
    departureremindersent INTEGER     DEFAULT 0,
    farmaddress           TEXT        DEFAULT NULL,
    difficulty            REAL        DEFAULT 0,
    isurgentpaid          INTEGER     DEFAULT 0,
    areapyeong            INTEGER     DEFAULT NULL,
    farmimages            TEXT        DEFAULT NULL,
    autojobtype           TEXT        DEFAULT NULL,
    tags                  TEXT        DEFAULT NULL,
    croptype              TEXT        DEFAULT NULL,
    autoassign            INTEGER     DEFAULT 0,
    paystatus             TEXT        DEFAULT 'none',
    paymethod             TEXT        DEFAULT NULL,
    paymentstatus         TEXT        DEFAULT 'pending',
    paymentid             TEXT        DEFAULT NULL,
    fee                   INTEGER     DEFAULT 0,
    netamount             INTEGER     DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workers (
    id                  TEXT    PRIMARY KEY,
    userid              TEXT    NOT NULL,
    name                TEXT    NOT NULL,
    phone               TEXT    NOT NULL,
    baselocationtext    TEXT    NOT NULL,
    latitude            REAL,
    longitude           REAL,
    serviceradiuskm     INTEGER DEFAULT 30,
    categories          TEXT    NOT NULL DEFAULT '[]',
    hastractor          INTEGER DEFAULT 0,
    hassprayer          INTEGER DEFAULT 0,
    hasrotary           INTEGER DEFAULT 0,
    completedjobs       INTEGER DEFAULT 0,
    rating              REAL    DEFAULT 4.5,
    availabletimetext   TEXT    DEFAULT '협의',
    notifyenabled       INTEGER DEFAULT 1,
    currentlat          REAL    DEFAULT NULL,
    currentlng          REAL    DEFAULT NULL,
    locationupdatedat   TEXT    DEFAULT NULL,
    successrate         REAL    DEFAULT 0,
    noshowcount         INTEGER DEFAULT 0,
    ratingavg           REAL    DEFAULT NULL,
    ratingcount         INTEGER DEFAULT 0,
    skilltags           TEXT    DEFAULT NULL,
    preferredtime       TEXT    DEFAULT NULL,
    activenow           INTEGER DEFAULT 0,
    preferreddifficulty REAL    DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS applications (
    id              TEXT    PRIMARY KEY,
    jobrequestid    TEXT    NOT NULL,
    workerid        TEXT    NOT NULL,
    message         TEXT    DEFAULT '',
    status          TEXT    DEFAULT 'applied',
    createdat       TEXT    NOT NULL,
    completedat     TEXT    DEFAULT NULL,
    UNIQUE (jobrequestid, workerid)
);

CREATE TABLE IF NOT EXISTS users (
    id                  TEXT    PRIMARY KEY,
    name                TEXT    NOT NULL,
    phone               TEXT    NOT NULL,
    role                TEXT    NOT NULL DEFAULT 'farmer',
    createdat           TEXT    NOT NULL,
    jobtype             TEXT    DEFAULT NULL,
    locationtext        TEXT    DEFAULT NULL,
    notifyenabled       INTEGER DEFAULT 1,
    lat                 REAL    DEFAULT NULL,
    lng                 REAL    DEFAULT NULL,
    abgroup             TEXT    DEFAULT NULL,
    urgenttrialused     INTEGER DEFAULT 0,
    referralcode        TEXT    DEFAULT NULL,
    referredby          TEXT    DEFAULT NULL,
    referralcount       INTEGER DEFAULT 0,
    referralrewarded    INTEGER DEFAULT 0,
    rating              REAL    DEFAULT 0,
    reviewcount         INTEGER DEFAULT 0,
    completedjobs       INTEGER DEFAULT 0,
    successrate         REAL    DEFAULT 0,
    preferreddifficulty REAL    DEFAULT 0.5,
    blocked             INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone     ON users(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral  ON users(referralcode) WHERE referralcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS contacts (
    id        TEXT    PRIMARY KEY,
    jobid     TEXT    NOT NULL,
    farmerid  TEXT    NOT NULL,
    workerid  TEXT    NOT NULL,
    createdat TEXT    NOT NULL,
    UNIQUE (jobid, workerid)
);

CREATE TABLE IF NOT EXISTS messages (
    id        TEXT    PRIMARY KEY,
    jobid     TEXT    NOT NULL,
    senderid  TEXT    NOT NULL,
    text      TEXT    NOT NULL,
    createdat TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
    id           TEXT    PRIMARY KEY,
    jobid        TEXT    NOT NULL,
    reviewerid   TEXT    NOT NULL,
    targetid     TEXT    NOT NULL,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT    DEFAULT '',
    createdat    TEXT    NOT NULL,
    tags         TEXT    DEFAULT NULL,
    ispublic     INTEGER DEFAULT 0,
    reviewerrole TEXT    DEFAULT NULL,
    UNIQUE (jobid, reviewerid)
);

CREATE TABLE IF NOT EXISTS reports (
    id         TEXT    PRIMARY KEY,
    jobid      TEXT    NOT NULL,
    reporterid TEXT    NOT NULL,
    reason     TEXT    NOT NULL,
    createdat  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics (
    id        TEXT    PRIMARY KEY,
    event     TEXT    NOT NULL,
    jobid     TEXT,
    userid    TEXT,
    meta      TEXT    DEFAULT '{}',
    createdat TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);

CREATE TABLE IF NOT EXISTS payments (
    id         BIGSERIAL   PRIMARY KEY,
    userid     TEXT        NOT NULL,
    jobid      TEXT        NOT NULL,
    amount     INTEGER     NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'ready',
    provider   TEXT        NOT NULL DEFAULT 'toss',
    orderid    TEXT        NOT NULL UNIQUE,
    paymentkey TEXT,
    createdat  TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(orderid);
CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(userid);

CREATE TABLE IF NOT EXISTS notify_log (
    id        TEXT    PRIMARY KEY,
    jobid     TEXT    NOT NULL,
    phone     TEXT    NOT NULL,
    type      TEXT    NOT NULL,
    sentat    TEXT    NOT NULL,
    userid    TEXT    DEFAULT NULL,
    message   TEXT    DEFAULT '',
    createdat TEXT    DEFAULT NULL,
    UNIQUE (jobid, phone, type)
);

CREATE INDEX IF NOT EXISTS idx_notify_log_user ON notify_log(userid, createdat DESC);
CREATE INDEX IF NOT EXISTS idx_applications_job_created ON applications(jobrequestid, createdat);

CREATE TABLE IF NOT EXISTS user_behavior (
    id        BIGSERIAL   PRIMARY KEY,
    userid    TEXT        NOT NULL,
    jobid     TEXT        NOT NULL,
    action    TEXT        NOT NULL,
    jobtype   TEXT,
    lat       REAL,
    lng       REAL,
    createdat BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_behavior_user_time ON user_behavior(userid, createdat DESC);

CREATE TABLE IF NOT EXISTS sponsored_jobs (
    jobid     TEXT    NOT NULL PRIMARY KEY,
    boost     INTEGER NOT NULL DEFAULT 20,
    expiresat BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    userid        TEXT    NOT NULL PRIMARY KEY,
    tier          TEXT    NOT NULL DEFAULT 'free',
    priorityboost INTEGER NOT NULL DEFAULT 10,
    expiresat     BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS rl_qtable (
    state     TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    q         REAL    NOT NULL DEFAULT 0,
    updatedat BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (state, action)
);

CREATE TABLE IF NOT EXISTS bandit_context_arms (
    experimentid TEXT    NOT NULL,
    variantkey   TEXT    NOT NULL,
    timebucket   INTEGER NOT NULL,
    regionbucket TEXT    NOT NULL,
    impressions  INTEGER NOT NULL DEFAULT 0,
    applies      INTEGER NOT NULL DEFAULT 0,
    updatedat    BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (experimentid, variantkey, timebucket, regionbucket)
);

CREATE TABLE IF NOT EXISTS bandit_arms (
    experimentid TEXT    NOT NULL,
    variantkey   TEXT    NOT NULL,
    impressions  INTEGER NOT NULL DEFAULT 0,
    applies      INTEGER NOT NULL DEFAULT 0,
    updatedat    BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (experimentid, variantkey)
);

CREATE TABLE IF NOT EXISTS system_flags (
    key       TEXT    PRIMARY KEY,
    value     TEXT    NOT NULL,
    updatedat BIGINT  NOT NULL
);

INSERT INTO system_flags (key, value, updatedat)
VALUES ('SAFE_MODE', '0', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS anomaly_snapshots (
    id        BIGSERIAL   PRIMARY KEY,
    ctr       REAL,
    applyrate REAL,
    ts        BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anomaly_ts ON anomaly_snapshots(ts DESC);

CREATE TABLE IF NOT EXISTS experiment_results (
    experimentid  TEXT    NOT NULL PRIMARY KEY,
    winnervariant TEXT    NOT NULL,
    decidedat     BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
    id        TEXT    PRIMARY KEY,
    variants  TEXT    NOT NULL,
    isactive  INTEGER NOT NULL DEFAULT 0,
    createdat BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
    userid       TEXT    NOT NULL,
    experimentid TEXT    NOT NULL,
    variantkey   TEXT    NOT NULL,
    assignedat   BIGINT  NOT NULL,
    PRIMARY KEY (userid, experimentid)
);

CREATE TABLE IF NOT EXISTS experiment_events (
    id           BIGSERIAL   PRIMARY KEY,
    userid       TEXT        NOT NULL,
    experimentid TEXT        NOT NULL,
    variantkey   TEXT        NOT NULL,
    eventtype    TEXT        NOT NULL,
    jobid        TEXT,
    createdat    BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_events ON experiment_events(experimentid, variantkey, eventtype);

CREATE TABLE IF NOT EXISTS job_feedback (
    id               BIGSERIAL   PRIMARY KEY,
    jobid            TEXT        NOT NULL,
    workerid         TEXT        NOT NULL,
    rating           INTEGER,
    actualdifficulty REAL,
    durationmin      INTEGER,
    createdat        BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_job    ON job_feedback(jobid);
CREATE INDEX IF NOT EXISTS idx_feedback_worker ON job_feedback(workerid);

CREATE TABLE IF NOT EXISTS rec_logs (
    id          BIGSERIAL   PRIMARY KEY,
    jobid       TEXT,
    workerid    TEXT,
    variantkey  TEXT,
    score       REAL,
    distkm      REAL,
    difficulty  REAL,
    jobtype     TEXT,
    autojobtype TEXT,
    createdat   BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rec_logs_time ON rec_logs(createdat DESC);

CREATE TABLE IF NOT EXISTS status_logs (
    id         TEXT    PRIMARY KEY,
    jobid      TEXT    NOT NULL,
    fromstatus TEXT    NOT NULL,
    tostatus   TEXT    NOT NULL,
    byuserid   TEXT    NOT NULL,
    createdat  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_logs_job ON status_logs(jobid, createdat DESC);

-- test_logs (testLog 라우트용)
CREATE TABLE IF NOT EXISTS test_logs (
    id        BIGSERIAL   PRIMARY KEY,
    event     TEXT        NOT NULL,
    payload   TEXT        DEFAULT '{}',
    createdat TEXT        NOT NULL
);
