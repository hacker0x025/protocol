import { tv } from 'tailwind-variants';
import { twMerge } from 'tailwind-merge';
import { forwardRef } from 'react';
import { Link } from '@remix-run/react';
import type { LinkProps } from '@remix-run/react';

const button = tv({
    base: 'font-sans text-base focus:outline-none focus-visible:ring-2',
    variants: {
        size: {
            base: 'leading-6.5 px-6 py-4',
            xs: ' leading-5.5 py-1.5 px-2.5',
            sm: 'leading-5.5 p-3',
            md: 'leading-6.5 px-4 py-3',
        },
        color: {
            default: 'bg-grey-900 text-white hover:bg-grey-800 shadow-md focus-visible:ring-grey-500',
            grey: 'bg-grey-200 text-grey-900 focus-visible:ring-grey-300 ',
        },
        disabled: {
            true: 'opacity-50 pointer-events-none',
        },
        roundness: {
            default: 'rounded-2xl',
            lg: 'rounded-3xl'
        },
    },
});

type ButtonProps = {
    /**
     * How large should the button be?
     */
    size?: 'base' | 'xs' | 'sm' | 'md';

    /**
     * What color to use?
     */
    color?: 'default' | 'grey';
    /**
     * Is button disabled?
     */
    disabled?: boolean;
    /**
     * How rounded the button should be
     */
    roundness?: 'default' | 'lg';
} & React.ComponentPropsWithRef<'button'>;

export const LinkButton = forwardRef<HTMLAnchorElement, ButtonProps & LinkProps>(function LinkButton(
    { children, className, color = 'default', size = 'base', roundness = 'default', disabled, ...other },
    ref,
) {
    return (
        <Link className={twMerge(button({ color, size, disabled, roundness }), className)} {...other} ref={ref}>
            {children}
        </Link>
    );
});

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { children, className, color = 'default', size = 'base', roundness = 'default', disabled, ...other },
    ref,
) {
    return (
        <button
            className={twMerge(button({ color, size, disabled, roundness }), className)}
            disabled={disabled}
            {...other}
            ref={ref}
        >
            {children}
        </button>
    );
});
