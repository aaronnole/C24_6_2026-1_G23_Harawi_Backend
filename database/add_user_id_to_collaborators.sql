ALTER TABLE IF EXISTS public.collaborators
    ADD COLUMN IF NOT EXISTS user_id integer;

ALTER TABLE IF EXISTS public.collaborators
    ALTER COLUMN name TYPE character varying(150);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_collaborator_user'
    ) THEN
        ALTER TABLE public.collaborators
            ADD CONSTRAINT fk_collaborator_user
            FOREIGN KEY (user_id)
            REFERENCES public.users (user_id)
            ON UPDATE NO ACTION
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'collaborators_user_id_key'
    ) THEN
        ALTER TABLE public.collaborators
            ADD CONSTRAINT collaborators_user_id_key UNIQUE (user_id);
    END IF;
END $$;
