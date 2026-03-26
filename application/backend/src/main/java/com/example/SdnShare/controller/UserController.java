package com.example.SdnShare.controller;

import com.example.SdnShare.dto.userDTO.UpdateUserRequest;
import com.example.SdnShare.dto.userDTO.UserResponse;
import com.example.SdnShare.enums.Role;
import com.example.SdnShare.service.auth.UserService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/users")
@CrossOrigin(origins = "*")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    // Obtener todos los usuarios - solo admins
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<UserResponse>> getAllUsers() {
        List<UserResponse> users = userService.getAllUsers();
        return ResponseEntity.ok(users);
    }


    // Obtener un usuario especifico por su ID
    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> getUserById(@PathVariable UUID id) {
        UserResponse user = userService.getUserById(id);
        return ResponseEntity.ok(user);
    }



    // Obtener el perfil del usuario que esta autenticado
    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUser(Authentication authentication) {
        String email = authentication.getName();
        UserResponse user = userService.getUserByEmail(email);
        return ResponseEntity.ok(user);
    }

    // Obtener todos los usuarios activos - solo admins
    @GetMapping("/active")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<UserResponse>> getActiveUsers() {
        List<UserResponse> users = userService.getActiveUsers();
        return ResponseEntity.ok(users);
    }

    // Obtener usuarios por su rol - solo admins
    @GetMapping("/role/{role}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<UserResponse>> getUsersByRole(@PathVariable Role role) {
        List<UserResponse> users = userService.getUsersByRole(role);
        return ResponseEntity.ok(users);
    }

    // Actualizar un usuario - el admin puede todo, los usuarios solo su informacion
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN') or #id == authentication.principal.id")
    public ResponseEntity<UserResponse> updateUser(
            @PathVariable UUID id,
            @RequestBody UpdateUserRequest request,
            Authentication authentication
    ) {
        // Los usuarios normales no pueden cambiar su rol ni estado activo
        // Solo los admins pueden hacer eso
        if (!isAdmin(authentication)) {
            request.setRole(null);
            request.setActive(null);
        }

        UserResponse updatedUser = userService.updateUser(id, request);
        return ResponseEntity.ok(updatedUser);
    }

    // Eliminar un usuario de forma fisica - solo admins
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteUser(@PathVariable UUID id) {
        userService.deleteUser(id);
        return ResponseEntity.noContent().build();
    }

    // Desactivar un usuario (soft delete) - solo admins
    @PatchMapping("/{id}/deactivate")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<UserResponse> deactivateUser(@PathVariable UUID id) {
        UserResponse user = userService.deactivateUser(id);
        return ResponseEntity.ok(user);
    }

    // Reactivar un usuario desactivado - solo admins
    @PatchMapping("/{id}/activate")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<UserResponse> activateUser(@PathVariable UUID id) {
        UserResponse user = userService.activateUser(id);
        return ResponseEntity.ok(user);
    }

    // Verifica si el usuario autenticado tiene rol de admin
    private boolean isAdmin(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
}