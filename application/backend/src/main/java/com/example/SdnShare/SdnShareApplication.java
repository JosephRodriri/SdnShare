package com.example.SdnShare;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class
SdnShareApplication {

	public static void main(String[] args) {
		SpringApplication.run(SdnShareApplication.class, args);
	}

}
