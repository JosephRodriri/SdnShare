package com.example.SdnShare.audit;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.Temporal;
import jakarta.persistence.TemporalType;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.util.Date;

@Getter
@Setter

@EntityListeners(AuditingEntityListener.class)
public class Auditable<U> {

    @CreatedBy
    @Column(name = "CREAD0_POR", updatable = false)
    private U createdBy;

    @CreatedDate
    @Column(name = "FECHA_CREACION", updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date creationDate;

    @LastModifiedBy
    @Column(name = "ULTIMA_MODIFICACION_POR")
    private U lastModifiedBy;

    @LastModifiedBy
    @Column(name = "ULTIMA_MODIFICAION_DATE", updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date lastModifiedDate;


}
