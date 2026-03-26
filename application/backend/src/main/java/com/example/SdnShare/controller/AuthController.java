package com.example.SdnShare.controller;

import com.example.SdnShare.dto.authDTO.AuthResponse;
import com.example.SdnShare.dto.authDTO.LoginRequest;
import com.example.SdnShare.dto.userDTO.RegisterRequest;
import com.example.SdnShare.service.auth.AuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/auth")

public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    //  Las excepciones se lanzan naturalmente y el handler las captura.

    @PostMapping("/register")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AuthResponse> register(@RequestBody RegisterRequest request) {
        // Las excepciones serán capturadas automáticamente por GlobalExceptionHandler
        AuthResponse response = authService.register(request);
        return ResponseEntity.ok(response);


    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@RequestBody LoginRequest request) {
        // BadCredentialsException será capturada por GlobalExceptionHandler
        AuthResponse response = authService.login(request);
        return ResponseEntity.ok(response);


    }


}