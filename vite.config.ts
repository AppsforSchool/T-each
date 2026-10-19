import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages では https://appsforschool.github.io/T-each/ に公開されるため、base を合わせる
export default defineConfig({
	base: '/T-each/',
	plugins: [react()],
})
