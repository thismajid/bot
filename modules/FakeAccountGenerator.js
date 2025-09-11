import { faker } from '@faker-js/faker';

export default class FakeAccountGenerator {
    static generateFakeEmail() {
        const emailTypes = [
            () => faker.internet.email(),
            () => faker.internet.email({
                firstName: faker.person.firstName(),
                lastName: faker.person.lastName(),
                provider: 'gmail.com'
            }),
            () => faker.internet.email({
                firstName: faker.person.firstName(),
                lastName: faker.person.lastName(),
                provider: 'yahoo.com'
            }),
            () => faker.internet.email({
                firstName: faker.person.firstName(),
                lastName: faker.person.lastName(),
                provider: 'hotmail.com'
            }),
            () => faker.internet.email({
                firstName: faker.person.firstName(),
                lastName: faker.person.lastName(),
                provider: 'outlook.com'
            }),
            () => `${faker.internet.username()}${faker.number.int({ min: 100, max: 9999 })}@gmail.com`,
            () => `${faker.person.firstName().toLowerCase()}${faker.person.lastName().toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`
        ];

        const randomType = emailTypes[Math.floor(Math.random() * emailTypes.length)];
        return randomType().toLowerCase();
    }

    static generateFakePassword() {
        const passwordTypes = [
            () => faker.internet.password({ length: 12, memorable: false, pattern: /[A-Za-z0-9!@#$%^&*]/ }),
            () => faker.internet.password({ length: 10, memorable: false }),
            () => `${faker.person.firstName()}${faker.number.int({ min: 1000, max: 9999 })}!`,
            () => `${faker.internet.username()}${faker.number.int({ min: 100, max: 999 })}@`,
            () => `${faker.lorem.word()}${faker.number.int({ min: 10, max: 99 })}#${faker.string.alphanumeric(3)}`,
            () => {
                const parts = [
                    faker.person.firstName(),
                    faker.number.int({ min: 1000, max: 9999 }),
                    faker.helpers.arrayElement(['!', '@', '#', '$', '%', '^', '&', '*'])
                ];
                return parts.join('');
            }
        ];

        const randomType = passwordTypes[Math.floor(Math.random() * passwordTypes.length)];
        return randomType();
    }

    static generateFakeAccountLine() {
        const email = faker.internet.email();
        const password = faker.internet.password();
        return `${email.toLowerCase()}:${password}`;
    }
}