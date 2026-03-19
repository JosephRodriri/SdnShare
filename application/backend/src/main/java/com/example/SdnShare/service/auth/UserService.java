package com.example.SdnShare.service.auth;

import com.example.SdnShare.constants.AppConstants;
import com.example.SdnShare.dto.userDTO.UpdateUserRequest;
import com.example.SdnShare.dto.userDTO.UserResponse;
import com.example.SdnShare.enums.Role;
import com.example.SdnShare.model.User;
import com.example.SdnShare.repository.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private AppConstants appConstants;



    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;

    }

    // Obtener todos los usuarios
    public List<UserResponse> getAllUsers() {
        return userRepository.findAll().stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
    }

    // Obtener un usuario por su ID
    public UserResponse getUserById(UUID id) {
        User user = findUserById(id);
        return convertToResponse(user);
    }

    // Obtener un usuario por email
    public UserResponse getUserByEmail(String email) {
        User user = findUserByEmail(email);
        return convertToResponse(user);
    }

    //Obtener usuario por apellido
    public UserResponse getUserByLastName(String lastName) {
        User user = findUserByLastName(lastName);
        return convertToResponse(user);
    }

    // Obtener todos los usuarios activos
    public List<UserResponse> getActiveUsers() {
        return userRepository.findByActive(true).stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
    }

    // Obtener usuarios segun su rol
    public List<UserResponse> getUsersByRole(Role role) {
        return userRepository.findByRole(role).stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
    }

    // Actualizar datos del usuario
    @Transactional
    public UserResponse updateUser(UUID id, UpdateUserRequest request) {
        User user = findUserById(id);

        // Solo actualizamos los campos que no sean nulos
        if (request.getFirstName() != null && !request.getFirstName().isEmpty()) {
            user.setFirstName(request.getFirstName());
        }

        if (request.getLastName() != null && !request.getLastName().isEmpty()) {
            user.setLastName(request.getLastName());
        }

        if (request.getEmail() != null && !request.getEmail().isEmpty()) {
            validateEmailUniqueness(request.getEmail(), id);
            user.setEmail(request.getEmail());
        }

        if (request.getPassword() != null && !request.getPassword().isEmpty()) {
            user.setPassword(passwordEncoder.encode(request.getPassword()));
        }

        if (request.getPhoneNumber() != null) {
            user.setPhoneNumber(request.getPhoneNumber());
        }

        if (request.getDirection() != null) {
            user.setDirection(request.getDirection());
        }

        if (request.getRole() != null) {
            user.setRole(request.getRole());
        }

        if (request.getActive() != null) {
            user.setActive(request.getActive());
        }

        User updatedUser = userRepository.save(user);
        return convertToResponse(updatedUser);
    }

    // Eliminar un usuario de forma fisica de la base de datos
    @Transactional
    public void deleteUser(UUID id) {
        User user = findUserById(id);
        userRepository.delete(user);
    }

    // Desactivar un usuario sin borrarlo de la base de datos (soft delete)
    @Transactional
    public UserResponse deactivateUser(UUID id) {
        User user = findUserById(id);
        user.setActive(false);
        User updatedUser = userRepository.save(user);
        return convertToResponse(updatedUser);
    }

    // Reactivar un usuario que estaba desactivado
    @Transactional
    public UserResponse activateUser(UUID id) {
        User user = findUserById(id);
        user.setActive(true);
        User updatedUser = userRepository.save(user);
        return convertToResponse(updatedUser);
    }

    // Busca el usuario por ID, lanza excepcion si no existe
    private User findUserById(UUID id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new UsernameNotFoundException(appConstants.USER_NOT_FOUND_ID + id));
    }

    // Busca el usuario por email, lanza excepcion si no existe
    private User findUserByEmail(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException(appConstants.USER_NOT_FOUND_EMAIL + email));
    }

    // Busca el suaurio por apellido, lanza la excepcion si no existe
    private User findUserByLastName(String lastName){
        return userRepository.findByLastName(lastName)
                .orElseThrow(() -> new UsernameNotFoundException(appConstants.USER_NOT_FOUND_LAST_NAME + lastName) );
    }

    // Verifica que el email no este siendo usado por otro usuario
    // Excluye el usuario actual para poder actualizar otros datos sin cambiar el email
    private void validateEmailUniqueness(String email, UUID excludeUserId) {
        userRepository.findByEmail(email).ifPresent(existingUser -> {
            if (!existingUser.getId().equals(excludeUserId)) {
                throw new DataIntegrityViolationException(appConstants.EMAIL_ALREADY_IN_USE);
            }
        });
    }

    // Convierte un User a UserResponse para no exponer datos sensibles como la contrasena
    private UserResponse convertToResponse(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .email(user.getEmail())
                .phoneNumber(user.getPhoneNumber())
                .direction(user.getDirection())
                .role(user.getRole())
                .registrationDate(user.getRegistrationDate())
                .active(user.getActive())
                .build();
    }
}