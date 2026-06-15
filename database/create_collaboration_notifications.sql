CREATE TABLE IF NOT EXISTS public.collaboration_notifications
(
    notification_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
    project_id integer NOT NULL,
    collaborator_id integer NOT NULL,
    sender_user_id integer NOT NULL,
    recipient_user_id integer NOT NULL,
    status character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'PENDING'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    responded_at timestamp without time zone,

    CONSTRAINT collaboration_notifications_pkey PRIMARY KEY (notification_id),

    CONSTRAINT fk_collaboration_notifications_project FOREIGN KEY (project_id)
        REFERENCES public.projects (project_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,

    CONSTRAINT fk_collaboration_notifications_collaborator FOREIGN KEY (collaborator_id)
        REFERENCES public.collaborators (collaborator_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,

    CONSTRAINT fk_collaboration_notifications_sender FOREIGN KEY (sender_user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,

    CONSTRAINT fk_collaboration_notifications_recipient FOREIGN KEY (recipient_user_id)
        REFERENCES public.users (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,

    CONSTRAINT collaboration_notifications_status_check CHECK (
        status::text = ANY (
            ARRAY[
                'PENDING'::character varying,
                'ACCEPTED'::character varying,
                'REJECTED'::character varying
            ]::text[]
        )
    )
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.collaboration_notifications
    OWNER to postgres;
