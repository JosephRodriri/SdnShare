package com.example.SdnShare.model;

import com.example.SdnShare.audit.Auditable;
import com.example.SdnShare.enums.Role;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.*;
import java.util.UUID;



@Entity
@Inheritance(strategy = InheritanceType.JOINED)
@Table(name = "usuarios")
public class User extends Auditable<User> implements UserDetails {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "nombre", nullable = false)
    @NotBlank(message = "El campo firstName no puede quedar en blanco")
    private String firstName;

    @Column(name = "apellido", nullable = false)
    @NotBlank(message = "El campo lastName no puede quedar en blanco")
    private String lastName;

    @Column(name = "contrasena", nullable = false)
    @NotBlank(message = "El campo password no puede quedar en blanco")
    private String password;

    @Column(name = "correo", unique = true, nullable = false)
    @NotBlank(message = "El campo email no puede quedar en blanco")
    private String email;

    @Column(name = "numero_telefono")
    private String phoneNumber;

    @Column(name = "direccion")
    private String direction;

    @Column(name = "fecha_registro")
    private LocalDateTime registrationDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "rol", nullable = false)
    private Role role;

    @Column(name = "activo")
    private Boolean active = true;

    public User(String firstName, String lastName, String password, String email, String phoneNumber, String direction, LocalDateTime registrationDate, Role role, Boolean active) {
        this.firstName = firstName;
        this.lastName = lastName;
        this.password = password;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.direction = direction;
        this.registrationDate = registrationDate;
        this.role = role;
        this.active = active;
    }

    //constructor vacio
    public User() {

    }

    // Métodos de UserDetails para Spring Security
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }


    //getters and setters


    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    @Override
    public String getUsername() {
        return email; // Usamos el email como username
    }


    @Override
    public boolean isAccountNonExpired() {
        return true;
    }


    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }


    @Override
    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public void setPhoneNumber(String phoneNumber) {
        this.phoneNumber = phoneNumber;
    }

    public String getDirection() {
        return direction;
    }

    public void setDirection(String direction) {
        this.direction = direction;
    }

    public LocalDateTime getRegistrationDate() {
        return registrationDate;
    }

    public void setRegistrationDate(LocalDateTime registrationDate) {
        this.registrationDate = registrationDate;
    }

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
    }

    public Boolean getActive() {
        return active;
    }

    public void setActive(Boolean active) {
        this.active = active;
    }


    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }


}
