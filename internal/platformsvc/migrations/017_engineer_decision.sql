-- The platform relays virtual-engineer decision requests to the hosted model
-- with a server-held key. Use requires an explicitly assigned permission.
INSERT INTO platform.permissions (name) VALUES
    ('sender.engineer-decision'), ('sender.engineer-decision.create');
-- No default user grant. Administrators assign access through existing roles.
