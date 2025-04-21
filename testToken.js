import bcrypt from "bcrypt";
const tokenFromEmail = "31d29b7fd2d2ccb2c81175aa82d518c919a0586f94e7e053e02f05122b422478";
const tokenHashFromDB = "$2b$10$j.Os9Pmd/YdO2fCji4mlT.ob9K4NOtJUNxPBSxRSXaS98qGTA4BZq"; // Replace with hash from DB

bcrypt.compare(tokenFromEmail, tokenHashFromDB).then(isMatch => {
  console.log("Token Match:", isMatch);
});