package com.example.SdnShare.service.auth;

import com.example.SdnShare.dto.authDTO.AuthResponse;
import com.example.SdnShare.dto.authDTO.LoginRequest;
import com.example.SdnShare.dto.userDTO.RegisterRequest;
import com.example.SdnShare.model.User;
import com.example.SdnShare.repository.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class AuthService {



    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;


    // Mensajes de error centralizados
    private static final String EMAIL_ALREADY_REGISTERED = "El email ya esta registrado";
    private static final String USER_NOT_FOUND = "Usuario no encontrado";

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService,
                       AuthenticationManager authenticationManager) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.authenticationManager = authenticationManager;


    }

    // Registrar un nuevo usuario en el sistema
    public AuthResponse register(RegisterRequest request) {
        // Primero verificamos que el email no exista
        validateEmailUniqueness(request.getEmail());

        // Creamos el usuario con los datos del request
        User user = createUserFromRequest(request);

        // Lo guardamos en la base de datos
        userRepository.save(user);



        // Generamos y retornamos el token JWT
        String jwtToken = jwtService.generateToken(user);

        return buildAuthResponse(user, jwtToken, "Usuario registrado exitosamente");
    }

    // Autenticar usuario e iniciar sesion
    public AuthResponse login(LoginRequest request) {
        // Verificamos que las credenciales sean correctas
        // Si no son validas, AuthenticationManager lanza BadCredentialsException automaticamente
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getEmail(),
                        request.getPassword()
                )
        );

        // Buscamos el usuario en la base de datos
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new UsernameNotFoundException(USER_NOT_FOUND));

        // Generamos y retornamos el token JWT
        String jwtToken = jwtService.generateToken(user);

        return buildAuthResponse(user, jwtToken, "Login exitoso");
    }

    // Valida que el email no este registrado en el sistema
    private void validateEmailUniqueness(String email) {
        if (userRepository.findByEmail(email).isPresent()) {
            throw new DataIntegrityViolationException(EMAIL_ALREADY_REGISTERED);
        }
    }

    // Crea una instancia de User a partir del request de registro
    // Encripta la contrasena y establece valores por defecto
    private User createUserFromRequest(RegisterRequest request) {
        User user = new User();
        user.setId(request.getId());
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setPhoneNumber(request.getPhoneNumber());
        user.setDirection(request.getDirection());
        user.setRole(request.getRole());
        user.setRegistrationDate(LocalDateTime.now());
        user.setActive(true);
        return user;
    }



    // Construye la respuesta de autenticacion con el token y datos del usuario
    private AuthResponse buildAuthResponse(User user, String token, String message) {
        return AuthResponse.builder()
                .token(token)
                .email(user.getEmail())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .role(user.getRole())
                .message(message)
                .build();
    }
}
