package com.example.SdnShare.dto.userDTO;

import com.example.SdnShare.enums.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

// DTO para actualizar usuario
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateUserRequest {
    private UUID id;
    //COMPOSICION
    private String firstName;
    private String lastName;
    private String email;
    private String password; // Opcional, solo si se quiere cambiar
    private String phoneNumber;
    private String direction;
    private Role role;
    private Boolean active;
}