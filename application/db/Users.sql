SET TIME ZONE 'UTC';

-- Eliminar tabla actual
DROP TABLE IF EXISTS usuarios CASCADE;

-- Recrear con nombres limpios en minúsculas
CREATE TABLE usuarios (
                          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          nombre        VARCHAR(100) NOT NULL,
                          apellido      VARCHAR(100) NOT NULL,
                          contrasena    VARCHAR(255) NOT NULL,
                          correo        VARCHAR(255) NOT NULL UNIQUE,
                          numero_telefono VARCHAR(20),
                          direccion     VARCHAR(255),
                          fecha_registro TIMESTAMP,
                          rol           VARCHAR(20)  NOT NULL,
                          activo        BOOLEAN      DEFAULT true
);

COMMENT ON TABLE usuarios IS 'Tabla de usuarios de la aplicación ImageHub';
COMMENT ON COLUMN usuarios.id IS 'Identificador único UUID del usuario';
COMMENT ON COLUMN usuarios.NOMBRE IS 'Nombre del usuario';
COMMENT ON COLUMN usuarios.APELLIDO IS 'Apellido del usuario';
COMMENT ON COLUMN usuarios.CONTRASEÑA IS 'Contraseña encriptada con BCrypt (255 caracteres)';
COMMENT ON COLUMN usuarios.CORREO IS 'Email del usuario, único en el sistema';
COMMENT ON COLUMN usuarios.NUMERO_TELEFONO IS 'Número telefónico del usuario';
COMMENT ON COLUMN usuarios.DIRECCION IS 'Dirección residencial del usuario';
COMMENT ON COLUMN usuarios.FECHA_REGISTRO IS 'Fecha y hora del registro del usuario';
COMMENT ON COLUMN usuarios.ROL IS 'Rol del usuario: USER, ADMIN, EDITOR';
COMMENT ON COLUMN usuarios.ACTIVO IS 'Estado del usuario: true (activo), false (inactivo)';

CREATE INDEX idx_usuarios_correo ON usuarios(CORREO);
CREATE INDEX idx_usuarios_rol ON usuarios(ROL);
CREATE INDEX idx_usuarios_activo ON usuarios(ACTIVO);


CREATE TABLE IF NOT EXISTS audit_log (
                                         id SERIAL PRIMARY KEY,
                                         tabla_afectada VARCHAR(100) NOT NULL,
    id_registro UUID,
    tipo_operacion VARCHAR(20) NOT NULL,
    usuario VARCHAR(100),
    valores_anteriores TEXT,
    valores_nuevos TEXT,
    fecha_operacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_origen VARCHAR(50)
    );

COMMENT ON TABLE audit_log IS 'Registro de auditoría de cambios en tablas principales';
COMMENT ON COLUMN audit_log.tabla_afectada IS 'Nombre de la tabla modificada';
COMMENT ON COLUMN audit_log.tipo_operacion IS 'Tipo: INSERT, UPDATE, DELETE';

CREATE INDEX idx_audit_usuario ON audit_log(usuario);
CREATE INDEX idx_audit_fecha ON audit_log(fecha_operacion);
