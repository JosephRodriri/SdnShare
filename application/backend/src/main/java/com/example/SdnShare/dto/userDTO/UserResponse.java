package com.example.SdnShare.dto.userDTO;

import com.example.SdnShare.enums.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;


import java.time.LocalDateTime;
import java.util.UUID;

// DTO para respuesta de usuario (sin contraseña)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {
    private UUID id;
    //COMPOSICION
    private String firstName;
    private String lastName;
    private String email;
    private String phoneNumber;
    private String direction;
    private Role role;
    private LocalDateTime registrationDate;
    private Boolean active;
}