package com.example.SdnShare.dto.userDTO;

import com.example.SdnShare.enums.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;


// DTO para registro
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegisterRequest {
    private UUID id;
    //COMPOSICION
    private String firstName;
    private String lastName;
    private String email;
    private String password;
    private String phoneNumber;
    private String direction;
    private Role role; // ADMIN o USER
}
