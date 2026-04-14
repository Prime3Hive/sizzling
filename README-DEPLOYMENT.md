# Sizzling Spices Expense Tracker - Netlify Deployment Guide

## Prerequisites

1. A Netlify account (sign up at [netlify.com](https://netlify.com))
2. Your project files ready for deployment
3. Supabase project configured and running

## Deployment Steps

### Option 1: Drag and Drop Deployment

1. Run the build command locally:
   ```bash
   npm run build
   ```

2. Drag and drop the `dist` folder to Netlify's deployment area

### Option 2: Git Integration (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)

2. In Netlify:
   - Click "New site from Git"
   - Connect your repository
   - Configure build settings:
     - **Build command**: `npm run build`
     - **Publish directory**: `dist`
     - **Node version**: `18` (set in Environment Variables)

3. Deploy the site

## Environment Variables

Your app uses Supabase, so you need to set these environment variables in Netlify:

1. Go to Site settings > Environment variables
2. Add the following variables:
   - `VITE_SUPABASE_URL`: Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous key

**Note**: Since this project uses direct Supabase configuration in the client file, you may need to update `src/integrations/supabase/client.ts` if you want to use environment variables instead.

## Domain Configuration

### Custom Domain (Optional)

1. In Netlify, go to Site settings > Domain management
2. Add your custom domain
3. Configure DNS records as instructed by Netlify

### Supabase URL Configuration

1. In your Supabase dashboard, go to Authentication > URL Configuration
2. Add your Netlify domain to the allowed redirect URLs:
   - `https://your-netlify-domain.netlify.app`
   - `https://your-custom-domain.com` (if using custom domain)

## Performance Optimizations

The project includes several optimizations for Netlify:

- **Static asset caching**: CSS, JS, and images are cached for 1 year
- **Security headers**: Prevents XSS, clickjacking, and other attacks
- **SPA routing**: All routes redirect to index.html for proper client-side routing

## Troubleshooting

### Common Issues:

1. **404 errors on page refresh**: 
   - Ensure `_redirects` file is in the `public` folder
   - Check that the redirect rule is working in Netlify

2. **Supabase connection issues**:
   - Verify environment variables are set correctly
   - Check that your Supabase URL includes the correct project reference
   - Ensure redirect URLs are configured in Supabase

3. **Build failures**:
   - Check Node.js version compatibility
   - Ensure all dependencies are listed in package.json
   - Review build logs for specific error messages

### Getting Help

- Check Netlify's deployment logs for detailed error messages
- Review Supabase logs for authentication and database issues
- Test the build locally first: `npm run build && npm run preview`

## Production Checklist

- [ ] Environment variables configured in Netlify
- [ ] Supabase redirect URLs updated
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active (automatic with Netlify)
- [ ] All routes working correctly
- [ ] Authentication flow tested
- [ ] Database operations working
- [ ] Performance testing completed

## Post-Deployment

After successful deployment:

1. Test all major features:
   - User authentication (sign up, login, logout)
   - Dashboard functionality
   - Budget creation and management
   - Expense tracking
   - Reports generation

2. Monitor performance using Netlify Analytics

3. Set up form handling if you add contact forms later

Your Sizzling Spices Expense Tracker is now ready for production use!